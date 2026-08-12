"""访问统计 + 管理员看板：公开接口只暴露"本月访客数"这一个聚合数字，
更细的数据（注册数、Pro数、AI调用量、访问趋势）只有管理员账号能看。"""

import hashlib
import os
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db import DownloadLog, RequestLog, StatCounter, User, VisitLog, get_async_session
from users import current_active_user

# 哈希IP用的盐值，不设默认值兜底成固定字符串是为了防止有人拿一份公开的“默认盐”
# 直接查彩虹表反推真实IP——留空的话统计功能会跳过记录，不影响网站其它功能
VISIT_SALT = os.getenv("VISIT_SALT", "").strip()

# /api/parse、/api/download 目前完全开放（无登录无限流），这两个接口的每次调用都会记一条
# RequestLog（存原始IP，方便反查）。这个阈值只用来在管理后台标红提醒，不做自动封禁/拦截
SUSPICIOUS_REQUESTS_PER_DAY = 30
REQUEST_LOG_RETENTION_DAYS = 7

stats_router = APIRouter()


def _hash_ip(ip: str) -> str:
    return hashlib.sha256(f"{VISIT_SALT}:{ip}".encode()).hexdigest()[:32]


async def log_download(session: AsyncSession, request: Request, user: User | None) -> None:
    """成功下载一次记一行，登录用户按账号维度、匿名按哈希IP维度，用于管理后台的下载量统计"""
    if not request.client:
        return
    session.add(DownloadLog(user_id=user.id if user else None, ip_hash=_hash_ip(request.client.host)))
    await session.commit()


async def log_open_endpoint_request(session: AsyncSession, request: Request) -> None:
    """/api/parse、/api/download 这两个当前完全开放的接口专用：存原始IP，
    只是为了异常流量出现时能反查是谁在打，不做拦截"""
    if not request.client:
        return
    session.add(RequestLog(
        path=request.url.path,
        ip=request.client.host,
        user_agent=request.headers.get("user-agent"),
    ))
    await session.commit()


async def cleanup_old_request_logs(session: AsyncSession) -> None:
    """RequestLog 只用于短期排查，7天前的记录没有留存价值，进程启动时顺手清一次"""
    from sqlalchemy import delete
    cutoff = datetime.utcnow() - timedelta(days=REQUEST_LOG_RETENTION_DAYS)
    await session.execute(delete(RequestLog).where(RequestLog.created_at < cutoff))
    await session.commit()


async def increment_counter(session: AsyncSession, key: str) -> None:
    """AI 总结/问答被成功调用一次就 +1，用 UPSERT 保证第一次调用时行不存在也能正常计数"""
    stmt = sqlite_insert(StatCounter).values(key=key, value=1)
    stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value": StatCounter.value + 1})
    await session.execute(stmt)
    await session.commit()


@stats_router.post("/track-visit", status_code=204)
async def track_visit(request: Request, session: AsyncSession = Depends(get_async_session)):
    """前端每个浏览器会话调一次（不是每个页面/每次请求都调），记一条"今天这个人来过"。
    没配置 VISIT_SALT 就直接跳过——总比拿一个不安全的默认盐去哈希强"""
    if not VISIT_SALT or not request.client:
        return
    ip_hash = _hash_ip(request.client.host)
    stmt = sqlite_insert(VisitLog).values(visit_date=date.today(), ip_hash=ip_hash)
    stmt = stmt.on_conflict_do_nothing(index_elements=["visit_date", "ip_hash"])
    await session.execute(stmt)
    await session.commit()


@stats_router.get("/public")
async def public_stats(session: AsyncSession = Depends(get_async_session)):
    """给页脚用的公开数字，不需要登录"""
    month_start = date.today().replace(day=1)
    result = await session.execute(
        select(func.count(func.distinct(VisitLog.ip_hash))).where(VisitLog.visit_date >= month_start)
    )
    return {"month_visitors": result.scalar_one()}


@stats_router.get("/admin")
async def admin_stats(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="ADMIN_ONLY")

    total_users = (await session.execute(select(func.count(User.id)))).scalar_one()
    pro_users = (await session.execute(select(func.count(User.id)).where(User.is_pro.is_(True)))).scalar_one()

    reg_rows = await session.execute(
        select(User.registration_method, func.count(User.id)).group_by(User.registration_method)
    )
    registration_by_method = {method: count for method, count in reg_rows.all()}

    counters = (await session.execute(select(StatCounter))).scalars().all()
    counter_map = {c.key: c.value for c in counters}

    # 最近30天的每日访客趋势，没有访问记录的那几天要补 0，不然图表会断档/横轴对不上
    since = date.today() - timedelta(days=29)
    rows = await session.execute(
        select(VisitLog.visit_date, func.count(VisitLog.ip_hash))
        .where(VisitLog.visit_date >= since)
        .group_by(VisitLog.visit_date)
    )
    daily_map = {d: c for d, c in rows.all()}
    trend = []
    for i in range(30):
        d = since + timedelta(days=i)
        trend.append({"date": d.isoformat(), "count": daily_map.get(d, 0)})

    # 下载量统计：总量/今日/本月 + 近30天趋势，跟访客趋势同一套"按天分组、补0"逻辑，
    # DownloadLog.created_at 是 DateTime，按天分组要先转成日期
    now = datetime.utcnow()
    today_start = datetime.combine(date.today(), datetime.min.time())
    month_start_dt = datetime.combine(date.today().replace(day=1), datetime.min.time())
    since_dt = datetime.combine(since, datetime.min.time())

    total_downloads = (await session.execute(select(func.count(DownloadLog.id)))).scalar_one()
    today_downloads = (
        await session.execute(select(func.count(DownloadLog.id)).where(DownloadLog.created_at >= today_start))
    ).scalar_one()
    month_downloads = (
        await session.execute(select(func.count(DownloadLog.id)).where(DownloadLog.created_at >= month_start_dt))
    ).scalar_one()

    dl_rows = await session.execute(
        select(func.date(DownloadLog.created_at), func.count(DownloadLog.id))
        .where(DownloadLog.created_at >= since_dt)
        .group_by(func.date(DownloadLog.created_at))
    )
    dl_daily_map = {d: c for d, c in dl_rows.all()}
    download_trend = []
    for i in range(30):
        d = since + timedelta(days=i)
        download_trend.append({"date": d.isoformat(), "count": dl_daily_map.get(d.isoformat(), 0)})

    top_rows = await session.execute(
        select(User.email, func.count(DownloadLog.id).label("cnt"))
        .join(DownloadLog, DownloadLog.user_id == User.id)
        .group_by(User.id)
        .order_by(desc("cnt"))
        .limit(10)
    )
    top_users = [{"email": email, "count": cnt} for email, cnt in top_rows.all()]

    # 可疑IP：近24小时内命中开放接口次数超过阈值的IP，纯展示，不自动拦截
    suspicious_since = now - timedelta(hours=24)
    suspicious_rows = await session.execute(
        select(RequestLog.ip, func.count(RequestLog.id).label("cnt"), func.max(RequestLog.created_at))
        .where(RequestLog.created_at >= suspicious_since)
        .group_by(RequestLog.ip)
        .having(func.count(RequestLog.id) >= SUSPICIOUS_REQUESTS_PER_DAY)
        .order_by(desc("cnt"))
    )
    suspicious_ips = [
        {"ip": ip, "count": cnt, "last_seen": last_seen.isoformat() if last_seen else None}
        for ip, cnt, last_seen in suspicious_rows.all()
    ]

    return {
        "total_users": total_users,
        "pro_users": pro_users,
        "registration_by_method": registration_by_method,
        "ai_summarize_count": counter_map.get("ai_summarize", 0),
        "ai_chat_count": counter_map.get("ai_chat", 0),
        "visitor_trend": trend,
        "total_downloads": total_downloads,
        "today_downloads": today_downloads,
        "month_downloads": month_downloads,
        "download_trend": download_trend,
        "top_users": top_users,
        "suspicious_ips": suspicious_ips,
    }
