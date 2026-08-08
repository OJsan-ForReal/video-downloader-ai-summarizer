"""AI 视频总结模块：字幕提取 + OpenRouter 免费模型总结"""

import os
import re
import tempfile
import time
from typing import Optional

import httpx
import yt_dlp
from openai import OpenAI


def _is_bilibili_url(url: str) -> bool:
    return "bilibili.com" in url or "b23.tv" in url


class SubtitleExtractor:
    """从视频 URL 提取平台字幕（人工字幕 > 自动字幕）"""

    PREFERRED_LANGS = ["zh-Hans", "zh", "zh-CN", "en", "ja", "ko"]

    def extract(self, url: str) -> dict:
        """
        提取视频字幕，返回:
        {
            "has_subtitle": bool,
            "language": str,
            "subtitle_type": "manual" | "auto" | "none",
            "segments": [{"start": float, "end": float, "text": str}, ...],
            "full_text": str
        }
        """
        if _is_bilibili_url(url):
            result = self._extract_bilibili(url)
            if result["has_subtitle"]:
                return result

        info = self._get_video_info(url)

        manual_subs = {
            k: v for k, v in (info.get("subtitles") or {}).items() if k != "danmaku"
        }
        auto_subs = info.get("automatic_captions") or {}

        lang, sub_url, sub_type = self._pick_best_subtitle(manual_subs, auto_subs)
        if not sub_url:
            return self._empty()

        segments = self._download_and_parse(url, lang, sub_type)
        full_text = " ".join(seg["text"] for seg in segments)

        return {
            "has_subtitle": len(segments) > 0,
            "language": lang,
            "subtitle_type": sub_type,
            "segments": segments,
            "full_text": full_text,
        }

    @staticmethod
    def _empty() -> dict:
        return {
            "has_subtitle": False,
            "language": "",
            "subtitle_type": "none",
            "segments": [],
            "full_text": "",
        }

    def _extract_bilibili(self, url: str) -> dict:
        """B 站专用字幕提取（通过 dm/view API 获取 CC 字幕）"""
        try:
            bvid = self._parse_bvid(url)
            if not bvid:
                return self._empty()

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": f"https://www.bilibili.com/video/{bvid}",
            }

            view_resp = httpx.get(
                f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}",
                headers=headers, timeout=15,
            )
            view_data = view_resp.json().get("data", {})
            cid = view_data.get("cid")
            aid = view_data.get("aid")
            if not cid or not aid:
                return self._empty()

            dm_resp = httpx.get(
                f"https://api.bilibili.com/x/v2/dm/view?aid={aid}&oid={cid}&type=1",
                headers=headers, timeout=15,
            )
            dm_data = dm_resp.json().get("data", {})
            subtitle_list = dm_data.get("subtitle", {}).get("subtitles", [])
            if not subtitle_list:
                return self._empty()

            best = subtitle_list[0]
            for s in subtitle_list:
                if s.get("lan", "") in ("zh", "zh-Hans"):
                    best = s
                    break

            sub_type = "auto" if best.get("lan", "").startswith("ai-") else "manual"
            sub_url = best.get("subtitle_url", "")
            if sub_url.startswith("//"):
                sub_url = "https:" + sub_url
            if not sub_url:
                return self._empty()

            sub_resp = httpx.get(sub_url, headers=headers, timeout=15)
            body = sub_resp.json().get("body", [])

            segments = []
            for item in body:
                content = item.get("content", "").strip()
                if not content:
                    continue
                segments.append({
                    "start": round(item.get("from", 0), 2),
                    "end": round(item.get("to", 0), 2),
                    "text": content,
                })

            full_text = " ".join(seg["text"] for seg in segments)
            return {
                "has_subtitle": len(segments) > 0,
                "language": best.get("lan", "zh"),
                "subtitle_type": sub_type,
                "segments": segments,
                "full_text": full_text,
            }
        except Exception:
            return self._empty()

    @staticmethod
    def _parse_bvid(url: str) -> Optional[str]:
        m = re.search(r"(BV[a-zA-Z0-9]+)", url)
        return m.group(1) if m else None

    def _get_video_info(self, url: str) -> dict:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("无法解析该视频链接")
        return info

    def _pick_best_subtitle(self, manual_subs: dict, auto_subs: dict):
        """按优先级选择最佳字幕，返回 (lang, url, type)"""
        for lang in self.PREFERRED_LANGS:
            if lang in manual_subs:
                url = self._get_format_url(manual_subs[lang])
                if url:
                    return lang, url, "manual"

        for lang in self.PREFERRED_LANGS:
            if lang in auto_subs:
                url = self._get_format_url(auto_subs[lang])
                if url:
                    return lang, url, "auto"

        if manual_subs:
            first_lang = next(iter(manual_subs))
            url = self._get_format_url(manual_subs[first_lang])
            if url:
                return first_lang, url, "manual"

        if auto_subs:
            first_lang = next(iter(auto_subs))
            url = self._get_format_url(auto_subs[first_lang])
            if url:
                return first_lang, url, "auto"

        return "", None, "none"

    @staticmethod
    def _get_format_url(formats: list) -> Optional[str]:
        preferred = ["json3", "srv3", "vtt", "ttml"]
        for pref in preferred:
            for fmt in formats:
                if fmt.get("ext") == pref:
                    return fmt.get("url")
        return formats[0].get("url") if formats else None

    def _download_and_parse(self, url: str, lang: str, sub_type: str) -> list:
        """通过 yt-dlp 下载字幕文件并解析为分段列表"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "writesubtitles": sub_type == "manual",
                "writeautomaticsub": sub_type == "auto",
                "subtitleslangs": [lang],
                "subtitlesformat": "vtt",
                "outtmpl": os.path.join(tmp_dir, "subtitle"),
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            vtt_files = [f for f in os.listdir(tmp_dir) if f.endswith(".vtt")]
            if not vtt_files:
                return []
            return self._parse_vtt(os.path.join(tmp_dir, vtt_files[0]))

    @staticmethod
    def _parse_vtt(filepath: str) -> list:
        """解析 VTT 字幕文件为结构化分段"""
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        segments = []
        blocks = re.split(r"\n\n+", content)
        time_pattern = re.compile(
            r"(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})"
        )

        seen_texts = set()
        for block in blocks:
            lines = block.strip().split("\n")
            time_match = None
            text_lines = []
            for line in lines:
                m = time_pattern.search(line)
                if m:
                    time_match = m
                elif time_match and line.strip() and not line.strip().isdigit():
                    clean = re.sub(r"<[^>]+>", "", line.strip())
                    if clean:
                        text_lines.append(clean)

            if time_match and text_lines:
                text = " ".join(text_lines)
                if text in seen_texts:
                    continue
                seen_texts.add(text)

                start = _time_to_seconds(time_match.group(1))
                end = _time_to_seconds(time_match.group(2))
                segments.append({
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": text,
                })

        return segments


class VideoSummarizer:
    """使用 OpenRouter 免费模型生成视频总结、思维导图、问答

    免费模型有限速/偶发不可用的风险，用两层兜底：
    1. OpenRouter 原生 `models` 故障转移列表：第一个模型失败自动尝试下一个（服务端处理，单次请求）
    2. 整体请求的指数退避重试：应对瞬时网络问题或列表内模型同时不可用的极端情况
    """

    # 优先级列表：openrouter/free 由 OpenRouter 自己智能选可用免费模型，
    # 后面是手动挑的通用能力强、中文效果好的免费模型做兜底
    # 注意：OpenRouter 的 models 故障转移数组最多 3 项
    FALLBACK_MODELS = [
        "openrouter/free",
        "tencent/hy3:free",
        "google/gemma-4-31b-it:free",
    ]
    MAX_RETRIES = 3
    RETRY_BACKOFF_SECONDS = 1.5

    def __init__(self):
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY 环境变量未设置")
        self.client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1")

    def _create(self, **kwargs):
        """带故障转移列表 + 指数退避重试的 chat.completions.create 封装"""
        last_err = None
        for attempt in range(self.MAX_RETRIES):
            try:
                return self.client.chat.completions.create(
                    model=self.FALLBACK_MODELS[0],
                    extra_body={"models": self.FALLBACK_MODELS},
                    extra_headers={
                        "HTTP-Referer": "http://localhost:5173",
                        "X-Title": "Universal Video Downloader",
                    },
                    **kwargs,
                )
            except Exception as e:
                last_err = e
                status = getattr(e, "status_code", None)
                retryable = status in (429, 500, 502, 503) or status is None
                if not retryable or attempt == self.MAX_RETRIES - 1:
                    raise
                time.sleep(self.RETRY_BACKOFF_SECONDS * (2 ** attempt))
        raise last_err

    def summarize_stream(self, subtitle_text: str, language: str = "zh"):
        """流式生成视频总结，yield 每个 token"""
        prompt = self._build_summary_prompt(subtitle_text, language)
        response = self._create(
            messages=[
                {"role": "system", "content": "你是一个专业的视频内容分析助手，擅长提取关键信息并生成结构化的总结。"},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            temperature=0.7,
            max_tokens=4096,
        )
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    def generate_mindmap(self, subtitle_text: str, language: str = "zh") -> str:
        """生成思维导图 Markdown（非流式，一次性返回）"""
        prompt = self._build_mindmap_prompt(subtitle_text, language)
        response = self._create(
            messages=[
                {"role": "system", "content": "你是一个专业的思维导图生成助手，擅长将内容组织为清晰的层级结构。"},
                {"role": "user", "content": prompt},
            ],
            stream=False,
            temperature=0.5,
            max_tokens=4096,
        )
        return response.choices[0].message.content

    def chat_stream(self, subtitle_text: str, question: str):
        """基于视频内容的 AI 问答，流式返回"""
        prompt = self._build_chat_prompt(subtitle_text, question)
        response = self._create(
            messages=[
                {"role": "system", "content": "你是一个视频内容问答助手。根据提供的视频字幕内容来回答用户的问题。如果问题超出视频内容范围，请诚实告知。"},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            temperature=0.7,
            max_tokens=2048,
        )
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    @staticmethod
    def _build_summary_prompt(subtitle_text: str, language: str) -> str:
        truncated = subtitle_text[:15000]
        lang_hint = "中文" if language.startswith("zh") else "与原文相同的语言"
        return f"""请对以下视频字幕内容进行深度总结分析，使用{lang_hint}输出。

要求输出格式：
## 视频概述
（用2-3句话概括视频的主题和核心内容）

## 内容大纲
（按视频内容的逻辑顺序，列出主要章节/段落，每个章节包含要点）

## 核心知识要点
（提取视频中最重要的知识点、观点或结论，用编号列表形式）

## 总结
（用1-2句话给出整体评价或一句话总结）

---
视频字幕内容：
{truncated}"""

    @staticmethod
    def _build_mindmap_prompt(subtitle_text: str, language: str) -> str:
        truncated = subtitle_text[:15000]
        lang_hint = "中文" if language.startswith("zh") else "与原文相同的语言"
        return f"""请将以下视频字幕内容整理为思维导图结构，使用{lang_hint}输出。

要求：
1. 使用 Markdown 标题层级格式（# 一级标题，## 二级标题，### 三级标题）
2. 最外层是视频主题
3. 第二层是主要章节/模块
4. 第三层是各章节的要点
5. 可以有第四层做更细的展开
6. 每个节点的文字要简洁精炼
7. 只输出 Markdown 内容，不要其他说明文字

---
视频字幕内容：
{truncated}"""

    @staticmethod
    def _build_chat_prompt(subtitle_text: str, question: str) -> str:
        truncated = subtitle_text[:12000]
        return f"""以下是一个视频的字幕内容，请根据这些内容回答用户的问题。

视频字幕内容：
{truncated}

---
用户问题：{question}

请基于视频内容给出准确、详细的回答。如果视频内容中没有相关信息，请诚实说明。"""


def _time_to_seconds(time_str: str) -> float:
    """将 HH:MM:SS.mmm 转为秒数"""
    parts = time_str.split(":")
    hours = int(parts[0])
    minutes = int(parts[1])
    seconds = float(parts[2])
    return hours * 3600 + minutes * 60 + seconds
