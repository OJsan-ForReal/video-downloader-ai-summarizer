"""用户账号数据库：SQLite（本地文件） + SQLAlchemy 异步引擎。

用 UUID 做主键（fastapi-users 的默认做法，不是我们自己拍脑袋定的），
OAuthAccount 表存"这个用户绑定了哪些第三方登录（Google等）"，一个用户可以绑多个。
"""

import uuid
from collections.abc import AsyncGenerator
from datetime import date, datetime

from fastapi import Depends
from fastapi_users.db import (
    SQLAlchemyBaseOAuthAccountTableUUID,
    SQLAlchemyBaseUserTableUUID,
    SQLAlchemyUserDatabase,
)
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    """SQLite 没有原生 UUID 类型，存成定长字符串；跟 fastapi-users 的 User.id（UUID）保持
    跨表可关联，避免每次都手写 String(36) 转换"""
    impl = CHAR(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID())
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value if isinstance(value, uuid.UUID) else uuid.UUID(value)

DATABASE_URL = "sqlite+aiosqlite:///./app.db"


class Base(DeclarativeBase):
    pass


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    pass


class User(SQLAlchemyBaseUserTableUUID, Base):
    # Google 登录的用户存 Google 头像地址；邮箱密码注册的用户没有真实头像，前端自己按邮箱生成一个默认头像
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    oauth_accounts: Mapped[list[OAuthAccount]] = relationship("OAuthAccount", lazy="joined")

    # 记录最初是通过哪种方式注册的（"email" 邮箱密码 / "google" Google登录），只在账号创建那一刻
    # 写一次，之后哪怕又绑定了另一种登录方式也不会被覆盖——这里存的是"最初怎么来的"，不是"现在能用哪些方式登录"。
    # 邮箱密码这条路径靠 mapped_column 的 default 兜底；Google 这条路径在 users.py 的 google_callback 里显式写入
    registration_method: Mapped[str] = mapped_column(String(20), default="email", server_default="email")

    # Stripe 订阅相关：is_pro 是当前额度系统实际会用到的字段；customer/subscription id
    # 存下来是为了以后能查订单、取消订阅，不用每次都反查 Stripe
    is_pro: Mapped[bool] = mapped_column(default=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 本期订阅到期/续费时间，来自 Stripe 的 current_period_end，前端展示"到期时间"用
    pro_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class VisitLog(Base):
    """访问统计：每行代表"某个哈希后的IP在某天访问过一次"，(date, ip_hash) 唯一约束
    天然去重——同一人当天刷新多少次页面都只占一行。哈希而不存原始IP是为了不留可
    反查个人的数据（GDPR 意义上的最小化处理），足够统计"多少人访问"这个聚合数字了"""
    __tablename__ = "visit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_date: Mapped[date] = mapped_column(Date, index=True)
    ip_hash: Mapped[str] = mapped_column(String(64))

    __table_args__ = (UniqueConstraint("visit_date", "ip_hash", name="uq_visit_date_iphash"),)


class StatCounter(Base):
    """简单的全局累加计数器（AI总结/问答调用次数这种只需要看"总共用了多少次"，
    不需要像访问量那样按天细分的场景），key-value 存一张表里，用的时候 UPSERT"""
    __tablename__ = "stat_counter"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)


class DownloadLog(Base):
    """每次成功下载记一行，用于管理后台的下载量统计（总量/每日/每月/按用户排行）。
    未登录下载 user_id 为空，只能计入总量，不会出现在按用户排行里"""
    __tablename__ = "download_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.utcnow)
    user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("user.id"), nullable=True)
    ip_hash: Mapped[str] = mapped_column(String(64))


class RequestLog(Base):
    """只记录当前完全开放（无登录、无限流）的 /api/parse、/api/download 两个接口，
    存的是原始IP（不哈希）——这张表存在的目的就是"出现异常流量时能反查是哪个IP"，
    跟 VisitLog 那种做匿名聚合统计的表定位不同。数据量控制：main.py 的 lifespan
    清理逻辑里会定期删掉7天前的旧记录，不会无限增长"""
    __tablename__ = "request_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.utcnow)
    path: Mapped[str] = mapped_column(String(255))
    ip: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)


class SubtitleSegment(Base):
    """字幕持久化：同一个视频（video_id 是"平台标识:视频ID"，比如"bilibili:BV1xx"
    或"youtube:dQw4w9WgXcQ"）第一次被总结/问答后，字幕存这里，以后再问同一个视频不用
    重新下载字幕/重新调用 Whisper（省时间也省 Groq 额度）。

    读写走 summarizer.py 里一个独立的同步 sqlite3 连接，不经过这里的异步 ORM session——
    SubtitleExtractor.extract() 是在 run_in_executor 的线程池里跑的同步函数，硬塞异步
    session 进去反而更麻烦，这张表定义留在这里只是为了让 create_db_and_tables() 统一建表"""
    __tablename__ = "subtitle_segment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(String(128), index=True)
    segment_index: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[float] = mapped_column(Float)
    end_time: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(20))
    subtitle_type: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.utcnow)


class Feedback(Base):
    """用户反馈：登录/未登录都能提交，标题+正文必填，图片可选。管理员在后台标记已读"""
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("user.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.utcnow)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


engine = create_async_engine(DATABASE_URL)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def _add_column_if_missing(conn, table: str, column: str, ddl_type: str, default_sql: str) -> None:
    """项目里没有 Alembic 这类迁移工具，`Base.metadata.create_all` 只会建缺失的表，不会给已存在的表
    补列——`user` 表已经有真实用户数据，新加字段（比如 registration_method）需要手动 ALTER 一下。
    先查 PRAGMA table_info 判断列在不在，不在才 ALTER，这样新库（create_all 已经带上新列）和
    老库跑这段代码都不会出错"""

    def _check(sync_conn):
        rows = sync_conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
        return any(row[1] == column for row in rows)

    has_column = await conn.run_sync(_check)
    if not has_column:
        await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type} DEFAULT {default_sql}")


async def create_db_and_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _add_column_if_missing(conn, "user", "registration_method", "VARCHAR(20)", "'email'")


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)
