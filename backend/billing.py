"""Stripe 订阅：创建结账会话 + 接收 Webhook。
沙盒模式，用于演示"接过完整支付集成"，不接真实收款（详见跟用户的讨论：
葡萄牙个体户上线收款要先去 Finanças 办开业申报，这个项目现阶段不做这件事）。
"""

import os
import uuid
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy import select

from db import User, async_session_maker
from users import FRONTEND_URL, current_active_user

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "").strip()
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
# 前端按同名逻辑隐藏了按钮，这里是第二道闸门——防止有人绕过前端直接调用这个接口。
# 线上部署的 .env 把这个设成 false（Stripe 还是沙盒模式，谁都能拿测试卡号白嫖 Pro 额度）
BILLING_ENABLED = os.getenv("BILLING_ENABLED", "true").strip().lower() != "false"

stripe.api_key = STRIPE_SECRET_KEY

# Pro 会员和免费用户的每日 AI 额度，quota.py 按这个来算
PRO_DAILY_LIMIT = 10

billing_router = APIRouter()


def _extract_period_end(subscription_data: dict) -> datetime | None:
    """Stripe 新版 API 把 current_period_end 挪到了 subscription item 里，不再是
    subscription 顶层字段（“billing_mode: flexible”），这里做个兼容取值"""
    items = (subscription_data.get("items") or {}).get("data") or []
    ts = subscription_data.get("current_period_end")
    if ts is None and items:
        ts = items[0].get("current_period_end")
    return datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None


@billing_router.post("/checkout")
async def create_checkout_session(user: User = Depends(current_active_user)):
    """登录用户点"升级 Pro"，返回一个 Stripe 托管付款页的链接，前端拿到直接跳转过去"""
    if not BILLING_ENABLED:
        raise HTTPException(status_code=403, detail="BILLING_DISABLED_ON_THIS_DEPLOYMENT")
    if not STRIPE_SECRET_KEY or not STRIPE_PRICE_ID:
        raise HTTPException(status_code=500, detail="Stripe 还没配置好（缺 SECRET_KEY 或 PRICE_ID）")

    session_kwargs = dict(
        mode="subscription",
        line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
        success_url=f"{FRONTEND_URL}/profile?checkout=success",
        cancel_url=f"{FRONTEND_URL}/profile?checkout=cancel",
        client_reference_id=str(user.id),
        metadata={"user_id": str(user.id)},
    )
    # 已经付过一次、有 Stripe 客户记录的老用户复用同一个 customer；第一次付款的新用户
    # 让 Stripe 自己按邮箱建一个 customer
    if user.stripe_customer_id:
        session_kwargs["customer"] = user.stripe_customer_id
    else:
        session_kwargs["customer_email"] = user.email

    session = await run_in_threadpool(stripe.checkout.Session.create, **session_kwargs)
    return {"checkout_url": session.url}


@billing_router.post("/webhook")
async def stripe_webhook(request: Request):
    """Stripe 那边付款成功/订阅取消时主动回调这个地址。签名校验没通过的请求
    （不是 Stripe 发的，或者密钥不对）一律拒绝，防止有人伪造"付款成功"骗额度"""
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Stripe Webhook 密钥还没配置")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="签名校验失败，不是 Stripe 发来的合法请求")

    event_type = event["type"]
    # stripe SDK 15.x 返回的是 StripeObject，不是普通 dict，没有 .get() 方法，
    # 转成真正的 dict 之后才能用 .get() 这套写法
    data = event["data"]["object"].to_dict()

    async with async_session_maker() as session:
        if event_type == "checkout.session.completed":
            user_id = data.get("client_reference_id") or (data.get("metadata") or {}).get("user_id")
            if user_id:
                user = await session.get(User, uuid.UUID(user_id))
                if user:
                    user.is_pro = True
                    user.stripe_customer_id = data.get("customer")
                    user.stripe_subscription_id = data.get("subscription")
                    await session.commit()

        elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
            # checkout.session.completed 只带了个订阅 ID，没带到期时间；到期时间在
            # 几乎同时触发的这两个事件里，续费的时候也是靠 updated 把新的到期时间刷新进来
            customer_id = data.get("customer")
            result = await session.execute(select(User).where(User.stripe_customer_id == customer_id))
            user = result.unique().scalar_one_or_none()
            if user:
                user.pro_expires_at = _extract_period_end(data)
                if data.get("status") == "active":
                    user.is_pro = True
                await session.commit()

        elif event_type == "customer.subscription.deleted":
            customer_id = data.get("customer")
            result = await session.execute(select(User).where(User.stripe_customer_id == customer_id))
            user = result.unique().scalar_one_or_none()
            if user:
                user.is_pro = False
                user.pro_expires_at = None
                await session.commit()

    return JSONResponse({"received": True})
