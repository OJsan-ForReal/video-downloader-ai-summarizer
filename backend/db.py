"""用户账号数据库：SQLite（本地文件） + SQLAlchemy 异步引擎。

用 UUID 做主键（fastapi-users 的默认做法，不是我们自己拍脑袋定的），
OAuthAccount 表存"这个用户绑定了哪些第三方登录（Google等）"，一个用户可以绑多个。
"""

from collections.abc import AsyncGenerator
from datetime import date, datetime

from fastapi import Depends
from fastapi_users.db import (
    SQLAlchemyBaseOAuthAccountTableUUID,
    SQLAlchemyBaseUserTableUUID,
    SQLAlchemyUserDatabase,
)
from sqlalchemy import Date, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

DATABASE_URL = "sqlite+aiosqlite:///./app.db"


class Base(DeclarativeBase):
    pass


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    pass


class User(SQLAlchemyBaseUserTableUUID, Base):
    # Google 登录的用户存 Google 头像地址；邮箱密码注册的用户没有真实头像，前端自己按邮箱生成一个默认头像
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    oauth_accounts: Mapped[list[OAuthAccount]] = relationship("OAuthAccount", lazy="joined")

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


engine = create_async_engine(DATABASE_URL)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def create_db_and_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)
