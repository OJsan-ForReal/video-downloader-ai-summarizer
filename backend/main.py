import os
import json
import shutil
import asyncio
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from downloader import VideoDownloader

downloader = VideoDownloader()


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
    title="万能视频下载器 API",
    description="基于 yt-dlp 的万能视频下载服务",
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


class ParseRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    format_id: str = "bestvideo+bestaudio/best"


class SummarizeRequest(BaseModel):
    url: str
    language: str = "zh"


class ChatRequest(BaseModel):
    url: str
    question: str
    subtitle_text: str = ""


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


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
async def summarize_video(req: SummarizeRequest) -> AsyncIterable[ServerSentEvent]:
    """
    AI 视频总结（SSE 流式）
    事件类型: subtitle / summary / mindmap / done / error
    """
    try:
        loop = asyncio.get_event_loop()
        extractor = _get_extractor()
        subtitle_data = await loop.run_in_executor(None, extractor.extract, req.url)

        yield ServerSentEvent(
            raw_data=json.dumps(subtitle_data, ensure_ascii=False),
            event="subtitle",
        )

        if not subtitle_data["has_subtitle"]:
            yield ServerSentEvent(
                raw_data=json.dumps({"message": "该视频没有可用的字幕，无法生成总结"}, ensure_ascii=False),
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
            raw_data=json.dumps({"message": f"总结失败: {str(e)}"}, ensure_ascii=False),
            event="error",
        )


@app.post("/api/chat", response_class=EventSourceResponse)
async def chat_with_video(req: ChatRequest) -> AsyncIterable[ServerSentEvent]:
    """AI 视频问答（SSE 流式）"""
    try:
        if not req.subtitle_text.strip():
            loop = asyncio.get_event_loop()
            extractor = _get_extractor()
            subtitle_data = await loop.run_in_executor(None, extractor.extract, req.url)
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
        for token in summarizer.chat_stream(subtitle_text, req.question):
            yield ServerSentEvent(raw_data=json.dumps(token, ensure_ascii=False), event="answer")

        yield ServerSentEvent(raw_data="[DONE]", event="done")

    except Exception as e:
        yield ServerSentEvent(
            raw_data=json.dumps({"message": f"回答失败: {str(e)}"}, ensure_ascii=False),
            event="error",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
