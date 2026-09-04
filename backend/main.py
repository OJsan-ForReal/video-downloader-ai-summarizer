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
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

import faq
import quota
import rag
from billing import PRO_DAILY_LIMIT, billing_router
from chat_history import append_message, get_recent_history, video_id_for_url
from db import User, async_session_maker, create_db_and_tables, get_async_session
from downloader import VideoDownloader
from feedback import UPLOAD_DIR, feedback_router
from schemas import UserCreate, UserRead, UserUpdate
from stats import cleanup_old_request_logs, increment_counter, log_download, log_open_endpoint_request, stats_router
from summarizer import (
    CONTEXT_LIMIT_THRESHOLD,
    FREE_WHISPER_MINUTES,
    PRO_WHISPER_MINUTES,
    rebuild_subtitle_rag_index,
)
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


def _whisper_minute_limit(user: User | None) -> int:
    """Whisper 转录兜底时允许的最长视频时长：管理员/Pro 会员 120 分钟，其余（含匿名访客）10 分钟"""
    if user is not None and (user.is_superuser or user.is_pro):
        return PRO_WHISPER_MINUTES
    return FREE_WHISPER_MINUTES


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

    # Chroma的持久化索引文件有可能损坏（比如进程异常崩溃、正好卡在写入索引的中途），
    # 启动时探活一次，坏了就清空重建——Chroma里存的都是能从别处重新算出来的派生数据
    # （FAQ来自faq_data/*.json，字幕来自subtitle_segment表），不是唯一保存的原始数据。
    # 字幕重建是相对重的操作（要重新embedding所有视频的所有chunk），只在真的探测到
    # 损坏时才做；FAQ重新加载很便宜（上百条数据、upsert幂等），不管这次是不是损坏、
    # 是不是全新空集合，都无条件跑一遍，保证FAQ数据不会因为集合是空的而一直缺失
    if not rag.is_healthy():
        print("[启动] Chroma索引异常，正在自动重建...")
        rag.reset_storage()
        subtitle_chunk_count = rebuild_subtitle_rag_index()
        print(f"[启动] 字幕索引重建完成：{subtitle_chunk_count} 条chunk")

    faq_count = faq.load_faq_into_chroma()
    print(f"[启动] FAQ数据已确认加载：{faq_count} 条")

    async with async_session_maker() as session:
        await cleanup_old_request_logs(session)
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

# 反馈图片的静态访问入口，UPLOAD_DIR 是 backend/uploads/feedback，挂载它的父目录
# 这样管理后台拿到的 image_path（形如 "feedback/xxx.jpg"）能直接拼成 /uploads/feedback/xxx.jpg
os.makedirs(os.path.dirname(UPLOAD_DIR), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=os.path.dirname(UPLOAD_DIR)), name="uploads")

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
app.include_router(feedback_router, prefix="/api/feedback", tags=["feedback"])
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
    # 多轮对话记忆的会话标识：已登录传 user.id、未登录传前端自己生成存 localStorage 的
    # UUID，由前端生成/管理，后端只管接收使用（见 chat_history.py）
    session_id: str


class FaqChatRequest(BaseModel):
    question: str
    language: str = "zh"  # zh/en/pt，FAQ三语言分开维护，检索只在当前语言内进行
    # 是否是本次会话的第一条消息，由前端自己维护并传入（跟 ChatRequest.session_id 记录的
    # 多轮对话记忆是两回事——FAQ问答目前不接对话记忆，见 faq.py 里的说明）
    is_first_turn: bool = True


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
async def parse_video(
    req: ParseRequest,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
):
    # /api/parse、/api/download 目前无登录无限流，谁都能直接调用——先不加拦截（用户明确
    # 表示暂不做限流），只记一条 RequestLog，方便管理后台在异常流量出现时反查是哪个IP
    await log_open_endpoint_request(session, request)
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, downloader.parse_video, req.url)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"解析失败: {e}")


def _cleanup_download_task(task_dir: str) -> None:
    """FileResponse 把文件发完给用户之后才会跑这个（BackgroundTask），删掉这次下载任务
    自己的临时目录（downloader.py 每次下载都用 uuid 建一个独立子目录）。之前只有整个
    后端进程关闭时才清一次 downloads/，服务长期不重启的话下载过的文件会一直堆在磁盘上"""
    shutil.rmtree(task_dir, ignore_errors=True)


@app.post("/api/download")
async def download_video(
    req: DownloadRequest,
    request: Request,
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
):
    await log_open_endpoint_request(session, request)
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, downloader.download_video, req.url, req.format_id
        )
        await log_download(session, request, user)
        task_dir = os.path.dirname(result["filepath"])
        return FileResponse(
            path=result["filepath"],
            filename=result["filename"],
            media_type="application/octet-stream",
            background=BackgroundTask(_cleanup_download_task, task_dir),
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
        minute_limit = _whisper_minute_limit(user)
        subtitle_data = await loop.run_in_executor(
            None, extractor.extract, req.url, req.source_language, minute_limit
        )

        yield ServerSentEvent(
            raw_data=json.dumps(subtitle_data, ensure_ascii=False),
            event="subtitle",
        )

        if not subtitle_data["has_subtitle"]:
            subtitle_type = subtitle_data.get("subtitle_type")
            if subtitle_type == "too_long":
                minutes = subtitle_data.get("duration_minutes", "?")
                if subtitle_data.get("upgrade_hint"):
                    message = f"该视频时长约 {minutes} 分钟，超过免费档 {FREE_WHISPER_MINUTES} 分钟上限，升级 Pro 可支持最长 {PRO_WHISPER_MINUTES} 分钟"
                else:
                    message = f"该视频时长约 {minutes} 分钟，超过当前 {minute_limit} 分钟上限，无法转录总结"
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


@app.get("/api/chat/history")
async def get_chat_history_route(
    url: str,
    session_id: str,
    session: AsyncSession = Depends(get_async_session),
):
    """给前端聊天面板展示历史用（跟 /api/chat 内部拼 prompt 那次查询是同一份数据，
    这里只是单独暴露一个只读接口，不消耗额度、不触发任何 AI 调用）"""
    history_video_id = video_id_for_url(url)
    history = await get_recent_history(session, history_video_id, session_id)
    return {"messages": history}


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
    # 对话记忆用的video_id（URL哈希）——跟下面字幕RAG检索用的subtitle_video_id
    # （"平台:视频ID"）是两套独立标识，不要混用，见 chat_history.py 里的说明
    history_video_id = video_id_for_url(req.url)

    try:
        loop = asyncio.get_event_loop()
        extractor = _get_extractor()
        subtitle_video_id = ""

        if not req.subtitle_text.strip():
            subtitle_data = await loop.run_in_executor(None, extractor.extract, req.url, req.source_language)
            if not subtitle_data["has_subtitle"]:
                yield ServerSentEvent(
                    raw_data=json.dumps({"message": "该视频没有可用的字幕，无法回答问题"}, ensure_ascii=False),
                    event="error",
                )
                return
            subtitle_text = subtitle_data["full_text"]
            subtitle_video_id = subtitle_data.get("video_id", "")
        else:
            subtitle_text = req.subtitle_text
            # 前端带了缓存的字幕文本过来，本来不需要再提取——但如果字幕长度超过直接注入的
            # 阈值，问答要走RAG检索，检索得按video_id过滤，这时才需要单独算一次video_id
            # （不用完整走一遍extract()，只解析视频信息，不重新下载字幕/不调用Whisper）
            if len(subtitle_text) > CONTEXT_LIMIT_THRESHOLD:
                subtitle_video_id = await loop.run_in_executor(None, extractor.get_video_id, req.url)

        history = await get_recent_history(session, history_video_id, req.session_id)

        summarizer = _get_summarizer()
        answer_parts: list[str] = []
        for token in summarizer.chat_stream(subtitle_video_id, subtitle_text, req.question, req.language, history=history):
            answer_parts.append(token)
            yield ServerSentEvent(raw_data=json.dumps(token, ensure_ascii=False), event="answer")

        # 等完整回答生成完再落库（而不是逐 token 写），一轮对话记两行：用户提问 + AI回答
        await append_message(session, history_video_id, req.session_id, "user", req.question)
        await append_message(session, history_video_id, req.session_id, "assistant", "".join(answer_parts))

        yield ServerSentEvent(raw_data="[DONE]", event="done")

    except Exception as e:
        yield ServerSentEvent(
            raw_data=json.dumps({"message": _friendly_ai_error("问答", e)}, ensure_ascii=False),
            event="error",
        )


@app.post("/api/faq/chat", response_class=EventSourceResponse)
async def faq_chat(req: FaqChatRequest) -> AsyncIterable[ServerSentEvent]:
    """FAQ 智能问答 QA agent（SSE 流式）。不消耗 AI 总结/问答那份每日额度——
    这是客服问答，跟视频处理是两类不同的功能配额"""
    try:
        for token in faq.faq_chat_stream(req.question, req.language, req.is_first_turn):
            yield ServerSentEvent(raw_data=json.dumps(token, ensure_ascii=False), event="answer")
        yield ServerSentEvent(raw_data="[DONE]", event="done")
    except Exception as e:
        yield ServerSentEvent(
            raw_data=json.dumps({"message": _friendly_ai_error("FAQ问答", e)}, ensure_ascii=False),
            event="error",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
