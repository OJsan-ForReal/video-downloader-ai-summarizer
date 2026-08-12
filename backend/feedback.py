"""用户反馈：登录/未登录都能提交（标题+正文必填，图片可选），管理员在后台查看/标记已读。
提交端用 quota.py 现成的按 IP 计数器做防灌水，跟注册限流是同一套机制。"""

import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

import quota
from db import Feedback, User, get_async_session
from users import current_active_user, current_active_user_optional

# 同一 IP 一天最多提交这么多条反馈，防止被脚本刷爆数据库/图片存储
MAX_FEEDBACK_PER_IP_PER_DAY = 5

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads", "feedback")

feedback_router = APIRouter()


async def _save_image(image: UploadFile) -> str:
    """校验类型+大小，落盘并返回相对路径（相对 UPLOAD_DIR 的父目录 uploads/，
    跟 main.py 里挂载的静态路由 /uploads 对应）"""
    ext = ALLOWED_IMAGE_TYPES.get(image.content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="仅支持 jpg/png/webp 格式的图片")

    data = await image.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(data)
    return f"feedback/{filename}"


@feedback_router.post("", status_code=201)
async def submit_feedback(
    request: Request,
    title: str = Form(...),
    content: str = Form(...),
    image: UploadFile | None = File(None),
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
):
    title = title.strip()
    content = content.strip()
    if not title or not content:
        raise HTTPException(status_code=400, detail="标题和内容不能为空")
    if len(title) > 200:
        raise HTTPException(status_code=400, detail="标题过长")

    ip = request.client.host if request.client else "unknown"
    if not quota.consume(f"feedback:{ip}", limit=MAX_FEEDBACK_PER_IP_PER_DAY):
        raise HTTPException(status_code=429, detail="今日反馈提交次数已达上限，请明天再来")

    image_path = await _save_image(image) if image is not None else None

    feedback = Feedback(
        user_id=user.id if user else None,
        title=title,
        content=content,
        image_path=image_path,
    )
    session.add(feedback)
    await session.commit()
    return {"success": True}


@feedback_router.get("")
async def list_feedback(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="ADMIN_ONLY")

    rows = await session.execute(
        select(Feedback, User.email)
        .join(User, User.id == Feedback.user_id, isouter=True)
        .order_by(desc(Feedback.created_at))
    )
    return [
        {
            "id": f.id,
            "title": f.title,
            "content": f.content,
            "image_path": f.image_path,
            "created_at": f.created_at.isoformat(),
            "is_read": f.is_read,
            "user_email": email,
        }
        for f, email in rows.all()
    ]


@feedback_router.patch("/{feedback_id}/read")
async def mark_feedback_read(
    feedback_id: int,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="ADMIN_ONLY")

    feedback = await session.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(status_code=404, detail="反馈不存在")

    feedback.is_read = not feedback.is_read
    await session.commit()
    return {"success": True, "is_read": feedback.is_read}
