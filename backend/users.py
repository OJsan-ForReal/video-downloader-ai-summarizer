"""用户账号系统：注册/登录/JWT/Google OAuth 的核心配置"""

import os
import secrets
import uuid

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, models, schemas
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.exceptions import InvalidPasswordException
from fastapi_users.jwt import decode_jwt
from fastapi_users.router.oauth import CSRF_TOKEN_KEY, STATE_TOKEN_AUDIENCE, generate_state_token
from httpx_oauth.clients.google import GoogleOAuth2
from httpx_oauth.integrations.fastapi import OAuth2AuthorizeCallback

import quota
from db import User, get_user_db
from mailer import send_verification_email

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


class TooManyRegistrationsError(Exception):
    """同一个 IP 今天注册的新账号太多了（防止靠疯狂开小号绕过 AI 调用额度限制）"""

AUTH_SECRET = os.getenv("AUTH_SECRET", "").strip()
if not AUTH_SECRET:
    raise ValueError("AUTH_SECRET 环境变量未设置（用于签发 JWT 和重置密码令牌，不能为空）")

# Google 的 client id/secret 需要去 Google Cloud Console 自己申请，留空时这个 client 能正常创建，
# 只有真的走 Google 登录流程时才会报错，不影响邮箱+密码这条主线
google_oauth_client = GoogleOAuth2(
    os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip(),
    os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip(),
)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = AUTH_SECRET
    verification_token_secret = AUTH_SECRET

    async def validate_password(
        self, password: str, user: "schemas.UserCreate | User"
    ) -> None:
        # fastapi-users 默认不校验密码强度（"123"这种也能注册成功），这里加个最基本的长度要求
        if len(password) < 8:
            raise InvalidPasswordException(reason="密码长度至少需要 8 位")

    async def create(
        self,
        user_create: "schemas.UC",
        safe: bool = False,
        request: Request | None = None,
    ) -> User:
        if request is not None and request.client:
            ip = request.client.host
            if not quota.consume(f"register:{ip}", limit=quota.MAX_REGISTRATIONS_PER_IP_PER_DAY):
                raise TooManyRegistrationsError()
        return await super().create(user_create, safe=safe, request=request)

    async def on_after_register(self, user: User, request: Request | None = None):
        print(f"用户注册成功: {user.email}")
        # Google 登录的用户创建时 is_verified 已经是 True（Google 自己验过邮箱了），
        # 不用再发一遍；邮箱密码注册的用户这里触发一次验证邮件
        if not user.is_verified:
            await self.request_verify(user, request)

    async def on_after_request_verify(self, user: User, token: str, request: Request | None = None):
        verify_url = f"{FRONTEND_URL}/verify-email?token={token}"
        await send_verification_email(user.email, verify_url)


async def get_user_manager(user_db: SQLAlchemyUserDatabase = Depends(get_user_db)):
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy[models.UP, models.ID]:
    return JWTStrategy(secret=AUTH_SECRET, lifetime_seconds=3600 * 24 * 7)  # 7 天有效期


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
# optional=True：登录了就拿到 user，没登录也不报错、返回 None——给"游客也能用，登录了用账号维度限额"这种场景用
current_active_user_optional = fastapi_users.current_user(active=True, optional=True)


# fastapi-users 自带的 get_oauth_router 在 Google 授权成功后只会返回一段裸 JSON（{access_token: ...}），
# 停在后端页面，不会跳回前端。这里自己实现 authorize/callback 这两个路由，
# 成功后直接 302 跳回前端并把 token 拼在 URL 上，前端从 URL 里取一次就存进 localStorage。
google_oauth_router = APIRouter()
_GOOGLE_CSRF_COOKIE = "google_oauth_csrf"
_GOOGLE_CALLBACK_ROUTE_NAME = "google-oauth-callback"


@google_oauth_router.get("/authorize")
async def google_authorize(request: Request, response: Response):
    # 前端是 fetch 这个接口拿 JSON 里的 authorization_url，自己再 window.location.href 跳转的，
    # 不能直接在这里 302——那样 fetch 会自己把跳转"吃掉"，前端拿到的就不是 JSON 了
    csrf_token = secrets.token_urlsafe(32)
    state = generate_state_token({CSRF_TOKEN_KEY: csrf_token}, AUTH_SECRET)
    redirect_uri = str(request.url_for(_GOOGLE_CALLBACK_ROUTE_NAME))
    authorization_url = await google_oauth_client.get_authorization_url(redirect_uri, state)

    response.set_cookie(_GOOGLE_CSRF_COOKIE, csrf_token, max_age=3600, httponly=True, samesite="lax")
    return {"authorization_url": authorization_url}


_google_oauth_callback = OAuth2AuthorizeCallback(google_oauth_client, route_name=_GOOGLE_CALLBACK_ROUTE_NAME)

GOOGLE_PROFILE_ENDPOINT = "https://people.googleapis.com/v1/people/me"


async def _fetch_google_profile(access_token: str) -> tuple[str, str, str | None]:
    """查邮箱的同时顺手把头像也要过来（personFields 里多加个 photos），
    省得再单独调一次 API"""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GOOGLE_PROFILE_ENDPOINT,
            params={"personFields": "emailAddresses,photos"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        profile = response.json()

    account_id = profile["resourceName"]
    account_email = next(
        e["value"] for e in profile["emailAddresses"] if e["metadata"]["primary"]
    )
    avatar_url = next(
        (p["url"] for p in profile.get("photos", []) if p.get("metadata", {}).get("primary")),
        None,
    )
    return account_id, account_email, avatar_url


@google_oauth_router.get("/callback", name=_GOOGLE_CALLBACK_ROUTE_NAME)
async def google_callback(
    request: Request,
    access_token_state: tuple = Depends(_google_oauth_callback),
    user_manager: UserManager = Depends(get_user_manager),
):
    token, state = access_token_state

    try:
        state_data = decode_jwt(state, AUTH_SECRET, [STATE_TOKEN_AUDIENCE])
    except Exception:
        return RedirectResponse(f"{FRONTEND_URL}/?auth_error=oauth_state_invalid")

    cookie_csrf = request.cookies.get(_GOOGLE_CSRF_COOKIE)
    if not cookie_csrf or cookie_csrf != state_data.get(CSRF_TOKEN_KEY):
        return RedirectResponse(f"{FRONTEND_URL}/?auth_error=oauth_state_invalid")

    try:
        account_id, account_email, avatar_url = await _fetch_google_profile(token["access_token"])
    except (httpx.HTTPStatusError, KeyError, StopIteration):
        return RedirectResponse(f"{FRONTEND_URL}/?auth_error=google_profile_failed")

    user = await user_manager.oauth_callback(
        google_oauth_client.name,
        token["access_token"],
        account_id,
        account_email,
        token.get("expires_at"),
        token.get("refresh_token"),
        request,
        associate_by_email=True,
        is_verified_by_default=True,
    )

    if avatar_url and user.avatar_url != avatar_url:
        user = await user_manager.user_db.update(user, {"avatar_url": avatar_url})

    jwt_token = await get_jwt_strategy().write_token(user)
    redirect = RedirectResponse(f"{FRONTEND_URL}/?token={jwt_token}")
    redirect.delete_cookie(_GOOGLE_CSRF_COOKIE)
    return redirect
