"""访问统计 + 管理员看板：公开接口只暴露"本月访客数"这一个聚合数字，
更细的数据（注册数、Pro数、AI调用量、访问趋势）只有管理员账号能看。"""

import hashlib
import os
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db import StatCounter, User, VisitLog, get_async_session
from users import current_active_user

# 哈希IP用的盐值，不设默认值兜底成固定字符串是为了防止有人拿一份公开的“默认盐”
# 直接查彩虹表反推真实IP——留空的话统计功能会跳过记录，不影响网站其它功能
VISIT_SALT = os.getenv("VISIT_SALT", "").strip()

stats_router = APIRouter()


def _hash_ip(ip: str) -> str:
    return hashlib.sha256(f"{VISIT_SALT}:{ip}".encode()).hexdigest()[:32]


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

    return {
        "total_users": total_users,
        "pro_users": pro_users,
        "ai_summarize_count": counter_map.get("ai_summarize", 0),
        "ai_chat_count": counter_map.get("ai_chat", 0),
        "visitor_trend": trend,
    }
