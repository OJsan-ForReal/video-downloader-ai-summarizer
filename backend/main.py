import os
import json
import shutil
import asyncio
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

import quota
from billing import PRO_DAILY_LIMIT, billing_router
from db import User, create_db_and_tables, get_async_session
from downloader import VideoDownloader
from schemas import UserCreate, UserRead, UserUpdate
from stats import increment_counter, stats_router
from summarizer import MAX_WHISPER_MINUTES
from users import TooManyRegistrationsError, auth_backend, current_active_user_optional, fastapi_users, google_oauth_router

downloader = VideoDownloader()

ADMIN_DAILY_LIMIT = 999  # 管理员（is_superuser）的每日额度，够用一整天不会真的撞上限


def _client_id(request: Request, user: User | None) -> str:
    """有登录用户就按账号维度算额度（更准），没登录就退回按 IP 粗略区分"""
    if user is not None:
        return f"user:{user.id}"
    return request.client.host if request.client else "unknown"


def _quota_limit(user: User | None) -> int:
    """管理员（superuser）不设上限，方便自己调试和给面试官演示；
    Pro 会员额度更高；其余（含匿名访客）用免费档"""
    if user is not None and user.is_superuser:
        return ADMIN_DAILY_LIMIT
    return PRO_DAILY_LIMIT if user is not None and user.is_pro else quota.FREE_DAILY_LIMIT


def _friendly_ai_error(action: str, e: Exception) -> str:
    """把 OpenRouter/Groq 这类第三方 AI 服务的报错，翻译成用户能看懂的话，
    而不是直接把 SDK 抛出的原始异常文本甩给用户"""
    status = getattr(e, "status_code", None)
    if status == 429:
        return f"{action}服务当前请求过多（触发限流），请稍后再试"
    if status in (500, 502, 503):
        return f"{action}服务暂时不可用，请稍后再试"
    return f"{action}失败: {str(e)}"


def _get_summarizer():
    """延迟初始化 VideoSummarizer（仅在首次调用时创建，缺 key 时报错清晰）"""
    from summarizer import VideoSummarizer
    if not hasattr(_get_summarizer, "_instance"):
        try:
            _get_summarizer._instance = VideoSummarizer()
        except ValueError as e:
            raise HTTPException(status_code=500, detail=str(e))
    return _get_summarizer._instance


def _get_extractor():
    from summarizer import SubtitleExtractor
    if not hasattr(_get_extractor, "_instance"):
        _get_extractor._instance = SubtitleExtractor()
    return _get_extractor._instance


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_db_and_tables()
    yield
    download_dir = downloader.DOWNLOAD_DIR
    if os.path.exists(download_dir):
        for f in os.listdir(download_dir):
            path = os.path.join(download_dir, f)
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path)
                else:
                    os.remove(path)
            except OSError:
                pass


app = FastAPI(
    title="音视频下载器 API",
    description="基于 yt-dlp 的音视频下载服务",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(TooManyRegistrationsError)
async def _too_many_registrations(request: Request, exc: TooManyRegistrationsError):
    return JSONResponse(status_code=429, content={"detail": "REGISTER_TOO_MANY_ACCOUNTS"})


app.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth/jwt", tags=["auth"])
app.include_router(fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth", tags=["auth"])
app.include_router(fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"])
app.include_router(google_oauth_router, prefix="/auth/google", tags=["auth"])
app.include_router(billing_router, prefix="/api/billing", tags=["billing"])
app.include_router(fastapi_users.get_verify_router(UserRead), prefix="/auth", tags=["auth"])
app.include_router(stats_router, prefix="/api/stats", tags=["stats"])
# 密码重置现在还没接（跟邮箱验证是两个独立的路由，这个还用不上），需要用到再补


class ParseRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    format_id: str = "bestvideo+bestaudio/best"


class SummarizeRequest(BaseModel):
    url: str
    language: str = "zh-Hans"  # 总结要翻译成什么语言
    source_language: str = ""  # 视频原语言，用于匹配字幕轨道 + Whisper 转录提示；留空="不确定，自动识别"


class ChatRequest(BaseModel):
    url: str
    question: str
    subtitle_text: str = ""
    language: str = "zh-Hans"
    source_language: str = ""


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/quota")
async def get_quota(request: Request, user: User | None = Depends(current_active_user_optional)):
    """查询当前客户端今日剩余 AI 额度，不消耗额度，前端用来在按钮上显示剩余次数"""
    identifier = _client_id(request, user)
    limit = _quota_limit(user)
    return {"remaining": quota.remaining(identifier, limit=limit), "limit": limit}


@app.post("/api/parse")
async def parse_video(req: ParseRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, downloader.parse_video, req.url)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"解析失败: {e}")


@app.post("/api/download")
async def download_video(req: DownloadRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, downloader.download_video, req.url, req.format_id
        )
        return FileResponse(
            path=result["filepath"],
            filename=result["filename"],
            media_type="application/octet-stream",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"下载失败: {e}")


@app.post("/api/summarize", response_class=EventSourceResponse)
async def summarize_video(
    req: SummarizeRequest,
    request: Request,
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
) -> AsyncIterable[ServerSentEvent]:
    """
    AI 视频总结（SSE 流式）
    事件类型: subtitle / summary / mindmap / done / error
    """
    if not quota.consume(_client_id(request, user), limit=_quota_limit(user)):
        yield ServerSentEvent(
            raw_data=json.dumps(
                {"message": f"今日 AI 总结额度已用完（每日 {_quota_limit(user)} 次），请明天再来"},
                ensure_ascii=False,
            ),
            event="error",
        )
        return

    await increment_counter(session, "ai_summarize")

    try:
        loop = asyncio.get_event_loop()
        extractor = _get_extractor()
        subtitle_data = await loop.run_in_executor(None, extractor.extract, req.url, req.source_language)

        yield ServerSentEvent(
            raw_data=json.dumps(subtitle_data, ensure_ascii=False),
            event="subtitle",
        )

        if not subtitle_data["has_subtitle"]:
            subtitle_type = subtitle_data.get("subtitle_type")
            if subtitle_type == "too_long":
                minutes = subtitle_data.get("duration_minutes", "?")
                message = f"该视频时长约 {minutes} 分钟，超过当前额度支持的 {MAX_WHISPER_MINUTES} 分钟上限，无法转录总结"
            elif subtitle_type == "whisper_failed":
                message = "语音转录服务当前请求过多或暂时不可用，请稍后再试"
            else:
                message = "该视频没有可用的字幕，无法生成总结"
            yield ServerSentEvent(
                raw_data=json.dumps({"message": message}, ensure_ascii=False),
                event="error",
            )
            return

        full_text = subtitle_data["full_text"]
        summarizer = _get_summarizer()

        for token in summarizer.summarize_stream(full_text, req.language):
            yield ServerSentEvent(raw_data=json.dumps(token, ensure_ascii=False), event="summary")

        mindmap_md = await loop.run_in_executor(
            None, summarizer.generate_mindmap, full_text, req.language
        )
        yield ServerSentEvent(
            raw_data=json.dumps({"markdown": mindmap_md}, ensure_ascii=False),
            event="mindmap",
        )

        yield ServerSentEvent(raw_data="[DONE]", event="done")

    except Exception as e:
        yield ServerSentEvent(
            raw_data=json.dumps({"message": _friendly_ai_error("总结", e)}, ensure_ascii=False),
            event="error",
        )


@app.post("/api/chat", response_class=EventSourceResponse)
async def chat_with_video(
    req: ChatRequest,
    request: Request,
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
) -> AsyncIterable[ServerSentEvent]:
    """AI 视频问答（SSE 流式）"""
    if not quota.consume(_client_id(request, user), limit=_quota_limit(user)):
        yield ServerSentEvent(
            raw_data=json.dumps(
                {"message": f"今日 AI 额度已用完（每日 {_quota_limit(user)} 次，总结和问答共用），请明天再来"},
                ensure_ascii=False,
            ),
            event="error",
        )
        return

    await increment_counter(session, "ai_chat")

    try:
        if not req.subtitle_text.strip():
            loop = asyncio.get_event_loop()
            extractor = _get_extractor()
            subtitle_data = await loop.run_in_executor(None, extractor.extract, req.url, req.source_language)
            if not subtitle_data["has_subtitle"]:
                yield ServerSentEvent(
                    raw_data=json.dumps({"message": "该视频没有可用的字幕，无法回答问题"}, ensure_ascii=False),
                    event="error",
                )
                return
            subtitle_text = subtitle_data["full_text"]
        else:
            subtitle_text = req.subtitle_text

        summarizer = _get_summarizer()
        for token in summarizer.chat_stream(subtitle_text, req.question, req.language):
            yield ServerSentEvent(raw_data=json.dumps(token, ensure_ascii=False), event="answer")

        yield ServerSentEvent(raw_data="[DONE]", event="done")

    except Exception as e:
        yield ServerSentEvent(
            raw_data=json.dumps({"message": _friendly_ai_error("问答", e)}, ensure_ascii=False),
            event="error",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
