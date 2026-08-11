"""用户账号相关的 Pydantic 读写模型（注册请求长什么样、返回给前端的用户信息长什么样）"""

import uuid
from datetime import datetime

from fastapi_users import schemas


class UserRead(schemas.BaseUser[uuid.UUID]):
    avatar_url: str | None = None
    is_pro: bool = False
    pro_expires_at: datetime | None = None


class UserCreate(schemas.BaseUserCreate):
    pass


class UserUpdate(schemas.BaseUserUpdate):
    pass
