"""AI 视频总结模块：字幕提取 + OpenRouter 免费模型总结"""

import os
import re
import sqlite3
import tempfile
import time
from datetime import datetime
from typing import Optional

import httpx
import yt_dlp
from openai import OpenAI

import rag


def _is_bilibili_url(url: str) -> bool:
    return "bilibili.com" in url or "b23.tv" in url


def _format_ts(seconds: float) -> str:
    """时间戳格式化成 mm:ss，超过1小时用 hh:mm:ss，给 AI 引用具体时间点用"""
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _build_full_text(segments: list[dict]) -> str:
    """拼接字幕全文，逐行带时间戳前缀（而不是纯文本 join），
    这样总结/问答的 AI prompt 里才有时间点可引用"""
    return "\n".join(f"[{_format_ts(seg['start'])}] {seg['text']}" for seg in segments)


# 字幕持久化用的是独立的同步 sqlite3 连接，不是 db.py 里的异步 SQLAlchemy session——
# SubtitleExtractor.extract() 跑在 run_in_executor 的线程池里，是同步函数，硬塞异步
# session 进去反而更麻烦。表结构定义仍然在 db.py 的 SubtitleSegment 里，两边指向同一张表
SUBTITLE_DB_PATH = "app.db"

# 长视频RAG检索用的分块窗口：字幕本身已经是segment（句子/短语级别）分好的，不需要再按
# 字符数切，只按时间窗口合并相邻segment成chunk，避免单个chunk太碎、检索到的内容缺乏
# 上下文。30秒是文档给的默认建议值，先用这个跑，后续根据实际检索效果再调整
CHUNK_WINDOW_SECONDS = 30


def _chunk_segments(segments: list[dict]) -> list[dict]:
    """把segment列表按时间窗口合并成RAG检索用的chunk列表，每个chunk保留合并进去的
    第一个segment的start、最后一个segment的end，供Chroma metadata记录时间范围用"""
    if not segments:
        return []
    chunks = []
    current: list[dict] = []
    window_start = segments[0]["start"]
    for seg in segments:
        if current and seg["start"] - window_start >= CHUNK_WINDOW_SECONDS:
            chunks.append(_merge_into_chunk(current))
            current = []
            window_start = seg["start"]
        current.append(seg)
    if current:
        chunks.append(_merge_into_chunk(current))
    return chunks


def _merge_into_chunk(segs: list[dict]) -> dict:
    return {
        "text": " ".join(s["text"] for s in segs),
        "start_time": segs[0]["start"],
        "end_time": segs[-1]["end"],
    }


def _get_cached_segments(video_id: str) -> Optional[dict]:
    """按 video_id 查有没有存过字幕，有就直接拼出跟 extract() 同样形状的结果字典返回"""
    conn = sqlite3.connect(SUBTITLE_DB_PATH)
    try:
        rows = conn.execute(
            "SELECT start_time, end_time, text, language, subtitle_type FROM subtitle_segment "
            "WHERE video_id = ? ORDER BY segment_index",
            (video_id,),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return None

    segments = [{"start": r[0], "end": r[1], "text": r[2]} for r in rows]
    return {
        "has_subtitle": True,
        "language": rows[0][3],
        "subtitle_type": rows[0][4],
        "segments": segments,
        "full_text": _build_full_text(segments),
        "video_id": video_id,
    }


def _save_segments(video_id: str, segments: list[dict], language: str, subtitle_type: str) -> None:
    """提取成功后存一份，供下次同一个视频直接命中缓存。先删旧的再插入整批新的，
    避免同一个 video_id 反复问答时越攒越多重复行"""
    if not segments:
        return
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(SUBTITLE_DB_PATH)
    try:
        conn.execute("DELETE FROM subtitle_segment WHERE video_id = ?", (video_id,))
        conn.executemany(
            "INSERT INTO subtitle_segment "
            "(video_id, segment_index, start_time, end_time, text, language, subtitle_type, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (video_id, i, seg["start"], seg["end"], seg["text"], language, subtitle_type, now)
                for i, seg in enumerate(segments)
            ],
        )
        conn.commit()
    finally:
        conn.close()

    # RAG检索用的向量库也要跟着更新，保持"字幕存一次，两个存储都更新"的逻辑在一起
    _index_subtitle_chunks(video_id, segments)


def _index_subtitle_chunks(video_id: str, segments: list[dict]) -> int:
    """分块+写入Chroma，供 _save_segments（正常提取流程）和 rebuild_subtitle_rag_index
    （Chroma索引损坏后的自愈重建）两处共用，不要各自维护一份重复逻辑。
    先删这个video_id的旧chunk再写入新的，避免新旧内容混在一起被检索到"""
    rag.delete_by_where({"video_id": video_id})
    chunks = _chunk_segments(segments)
    if chunks:
        rag.add_documents(
            ids=[f"{video_id}_chunk_{i}" for i in range(len(chunks))],
            texts=[c["text"] for c in chunks],
            metadatas=[
                {
                    "type": "subtitle",
                    "video_id": video_id,
                    "start_time": c["start_time"],
                    "end_time": c["end_time"],
                }
                for c in chunks
            ],
        )
    return len(chunks)


def rebuild_subtitle_rag_index() -> int:
    """把 subtitle_segment 表（持久化在SQLite，不受Chroma状态影响）里所有视频的字幕
    重新分块、重新写入Chroma，返回重建的chunk总数。用于main.py启动时探活发现Chroma
    索引损坏后的自愈重建——subtitle_segment表本身就是这次重建真正的数据来源"""
    conn = sqlite3.connect(SUBTITLE_DB_PATH)
    try:
        video_ids = [
            row[0] for row in conn.execute("SELECT DISTINCT video_id FROM subtitle_segment").fetchall()
        ]
    finally:
        conn.close()

    total = 0
    for video_id in video_ids:
        cached = _get_cached_segments(video_id)
        if cached:
            total += _index_subtitle_chunks(video_id, cached["segments"])
    return total


# 字幕问答的角色设定：诚实说不知道、不编造这条是硬性约束，放在 system 层而不是每次在
# user prompt 里重复；时间点引用依赖 full_text 里带的 [mm:ss] 前缀（见 _build_full_text）
SUBTITLE_CHAT_SYSTEM_PROMPT = (
    "你是一个视频内容问答助手，专注于回答当前视频内容相关的问题。"
    "根据提供的视频字幕内容来回答用户的问题。"
    "如果问题超出视频内容范围、或者字幕内容中没有相关信息，请诚实告知用户你不知道，不要编造答案。"
    "回答时如果能对应到具体时间点，优先引用（例如\"在03:12提到...\"）。"
    "请使用用户提问所使用的语言回答，不要固定用某一种语言。"
)


# 短视频问答"直接把全部字幕塞进prompt" vs 长视频"走RAG检索相关片段"的分界线，字符数近似。
# 沿用原来chat场景一直在用的12000这个截断值（不是新拍的数字）——这个值已经在生产用了很久，
# 对应当前FALLBACK_MODELS这些免费模型实际能稳定处理的上下文量、又留出了system prompt/
# 历史对话/回复的空间。项目目前没有引入分词器依赖，中英文字符数和token数的换算关系虽然
# 不完全线性，但这里只是一个"要不要走检索"的粗略分界线，不是精确的prompt裁剪，字符数
# 近似够用，没必要为了这一个判断专门引入tokenizer这类新依赖
CONTEXT_LIMIT_THRESHOLD = 12000

# 长视频走RAG检索时取回的chunk数量：每个chunk覆盖约CHUNK_WINDOW_SECONDS秒的内容，
# 5个chunk约2.5分钟，够覆盖问题相关的上下文，也不会把太多不相关内容塞进prompt稀释掉
# 真正相关的部分
RAG_TOP_K = 5


def get_video_context(video_id: str, question: str, full_text: str) -> tuple[str, str]:
    """长视频问答的自适应检索策略（核心原则：不是无脑全部走RAG）。

    字幕短于阈值就把全文直接注入prompt——短视频场景下不存在"检索漏掉相关内容"的
    风险，直接注入比RAG更准确；只有超过阈值、没法整段塞进prompt时，才走RAG检索
    最相关的几个片段，避免像以前那样简单截断丢内容。

    返回 (context, mode)，mode是"direct"或"rag"，只是给调用方/测试观察走了哪条
    分支用，不影响context本身的内容
    """
    if len(full_text) <= CONTEXT_LIMIT_THRESHOLD:
        return full_text, "direct"

    results = rag.query(question, doc_type="subtitle", top_k=RAG_TOP_K, extra_where={"video_id": video_id})
    context = "\n".join(
        f"[{_format_ts(r['metadata']['start_time'])}] {r['text']}" for r in results
    )
    return context, "rag"


# 支持的语言：AI 输出语言的显示名 + 总结小节标题 + 字幕轨道优先候选。
# 以后要加新语言（比如日语、韩语），在这里加一个条目即可，前端选项列表同步加一项。
DEFAULT_LANGUAGE = "zh-Hans"

SUPPORTED_LANGUAGES = {
    "zh-Hans": {
        "name": "简体中文",
        "subtitle_candidates": ["zh-Hans", "zh-CN", "zh"],
        "headers": {"overview": "视频概述", "outline": "内容大纲", "keypoints": "核心知识要点", "summary": "总结"},
    },
    "zh-Hant": {
        "name": "繁體中文",
        "subtitle_candidates": ["zh-Hant", "zh-TW", "zh-HK", "zh"],
        "headers": {"overview": "影片概述", "outline": "內容大綱", "keypoints": "核心知識要點", "summary": "總結"},
    },
    "en": {
        "name": "English",
        "subtitle_candidates": ["en", "en-US", "en-GB"],
        "headers": {"overview": "Overview", "outline": "Outline", "keypoints": "Key Takeaways", "summary": "Summary"},
    },
    "pt": {
        "name": "Português",
        "subtitle_candidates": ["pt", "pt-BR", "pt-PT"],
        "headers": {"overview": "Visão Geral", "outline": "Estrutura do Conteúdo", "keypoints": "Principais Pontos", "summary": "Resumo"},
    },
}


def _get_language_config(language: str) -> dict:
    return SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES[DEFAULT_LANGUAGE])


# Groq Whisper 语言强制参数用 ISO-639-1，不区分简繁（那是文字体系，不是语音语言）
GROQ_LANGUAGE_MAP = {"zh-Hans": "zh", "zh-Hant": "zh", "en": "en", "pt": "pt"}
GROQ_MAX_AUDIO_BYTES = 24 * 1024 * 1024  # 免费档上传上限 25MB，留 1MB 余量

# Whisper 转录要消耗 Groq 额度，按付费状态分两档：免费10分钟，Pro/管理员120分钟。
# 120分钟不是"真无限"——受限于 Groq Whisper 免费档单文件25MB的硬上限（GROQ_MAX_AUDIO_BYTES），
# 配合下面 _download_audio() 压低的音频码率，120分钟音频约21.6MB，留了安全余量
FREE_WHISPER_MINUTES = 10
PRO_WHISPER_MINUTES = 120


class SubtitleExtractor:
    """从视频 URL 提取字幕：平台字幕（人工 > 自动）优先，没有字幕的视频用 Groq Whisper 转录音频兜底"""

    # 通用兜底优先级：请求语言对应的候选轨道会被优先插到这个列表前面
    PREFERRED_LANGS = ["zh-Hans", "zh", "zh-CN", "zh-Hant", "zh-TW", "zh-HK", "en", "pt", "pt-BR", "pt-PT", "ja", "ko"]

    def extract(self, url: str, source_lang: str = "", max_minutes: int = FREE_WHISPER_MINUTES) -> dict:
        """
        提取视频字幕，返回:
        {
            "has_subtitle": bool,
            "language": str,
            "subtitle_type": "manual" | "auto" | "whisper" | "too_long" | "none",
            "segments": [{"start": float, "end": float, "text": str}, ...],
            "full_text": str,
            "duration_minutes": float,  # 仅 subtitle_type == "too_long" 时存在
            "upgrade_hint": bool,       # 仅 subtitle_type == "too_long" 时存在；卡在免费档上限时为 True
        }

        source_lang: 用户确认的视频原语言（如 "en"），用于优先匹配字幕轨道 + 作为 Whisper 转录的语言提示；
                     留空表示"不确定，自动识别"
        max_minutes: 无字幕、需要走 Whisper 兜底转录时允许的最长时长，由调用方按登录用户的付费状态传入
                     （免费10分钟 / Pro+管理员120分钟）；有平台字幕的视频不受此限制
        """
        if _is_bilibili_url(url):
            bvid = self._parse_bvid(url)
            video_id = f"bilibili:{bvid}" if bvid else None
            if video_id:
                cached = _get_cached_segments(video_id)
                if cached:
                    return cached

            result = self._extract_bilibili(url)
            if result["has_subtitle"]:
                if video_id:
                    _save_segments(video_id, result["segments"], result["language"], result["subtitle_type"])
                    result["video_id"] = video_id
                return result

        info = self._get_video_info(url)
        video_id = f"{info.get('extractor_key', 'unknown')}:{info.get('id', '')}"
        cached = _get_cached_segments(video_id)
        if cached:
            return cached

        manual_subs = {
            k: v for k, v in (info.get("subtitles") or {}).items() if k != "danmaku"
        }
        auto_subs = info.get("automatic_captions") or {}

        if source_lang:
            # 用户明确说了原语言：按语言优先级匹配人工/自动字幕轨道
            priority = self._build_priority(source_lang)
            lang, sub_url, sub_type = self._pick_best_subtitle(manual_subs, auto_subs, priority)
        else:
            # "自动识别"：不套用中文优先的通用列表（那会把中文当默认语言，非中文视频反而选错轨道）。
            # 只信人工字幕（信号明确，不管什么语言）；自动字幕语言不确定就不猜，交给下面的 Whisper 真正做语音识别
            lang, sub_url, sub_type = self._pick_any_manual_subtitle(manual_subs)

        if sub_url:
            try:
                segments = self._download_and_parse(url, lang, sub_type)
            except Exception:
                # 字幕轨道存在但下载失败（网络问题/平台限流等），别把整个请求搞崩，
                # 当作"没有可用字幕"处理，走到下面的 Whisper 兜底
                segments = []
            full_text = _build_full_text(segments)
            if segments:
                _save_segments(video_id, segments, lang, sub_type)
                return {
                    "has_subtitle": True,
                    "language": lang,
                    "subtitle_type": sub_type,
                    "segments": segments,
                    "full_text": full_text,
                    "video_id": video_id,
                }

        duration = info.get("duration") or 0
        if duration > max_minutes * 60:
            return self._too_long(duration, upgrade_hint=max_minutes <= FREE_WHISPER_MINUTES)

        whisper_result = self._transcribe_with_whisper(url, source_lang)
        if whisper_result:
            _save_segments(video_id, whisper_result["segments"], whisper_result["language"], whisper_result["subtitle_type"])
            whisper_result["video_id"] = video_id
            return whisper_result
        return self._empty()

    def get_video_id(self, url: str) -> str:
        """算出字幕缓存/RAG检索用的video_id（"平台:视频ID"），跟extract()内部算的是
        同一套规则。单独抽出这个方法是因为main.py的/api/chat在"前端已经带着缓存的
        subtitle_text过来、不需要重新提取字幕"这个分支里，仍然需要拿到video_id去
        Chroma按video_id过滤检索——这种情况下不需要（也不应该）跑一遍完整的extract()。

        注意这跟chat_history.py的video_id_for_url（对URL做哈希）是两套独立标识，
        互不通用：那边只是给对话记忆分组用的key，这边要跟SubtitleSegment表、Chroma
        里存的video_id对得上，才能查到同一个视频的字幕分块"""
        if _is_bilibili_url(url):
            bvid = self._parse_bvid(url)
            return f"bilibili:{bvid}" if bvid else ""
        info = self._get_video_info(url)
        return f"{info.get('extractor_key', 'unknown')}:{info.get('id', '')}"

    @staticmethod
    def _too_long(duration: float, upgrade_hint: bool) -> dict:
        return {
            "has_subtitle": False,
            "language": "",
            "subtitle_type": "too_long",
            "segments": [],
            "full_text": "",
            "duration_minutes": round(duration / 60, 1),
            "upgrade_hint": upgrade_hint,
        }

    @staticmethod
    def _whisper_failed() -> dict:
        """转录服务本身出错了（限流/网络/超时等），跟"这个视频压根没有字幕"是两码事，
        不能混在一起当成 _empty() 处理，不然用户会被"该视频没有可用的字幕"这句话误导"""
        return {
            "has_subtitle": False,
            "language": "",
            "subtitle_type": "whisper_failed",
            "segments": [],
            "full_text": "",
        }

    def _transcribe_with_whisper(self, url: str, source_lang: str) -> Optional[dict]:
        """视频没有平台字幕时，下载音轨丢给 Groq Whisper 转录（未配置 GROQ_API_KEY 时直接跳过，
        这种情况视为"没有这个兜底能力"，走 _empty()；真正调用失败则返回 _whisper_failed()）"""
        api_key = os.getenv("GROQ_API_KEY", "").strip()
        if not api_key:
            return None

        with tempfile.TemporaryDirectory() as tmp_dir:
            audio_path = self._download_audio(url, tmp_dir)
            if not audio_path or os.path.getsize(audio_path) > GROQ_MAX_AUDIO_BYTES:
                return None

            # max_retries=1：SDK 自动重试1次（总共最多2次真实请求），避免默认值2（总共3次）过多消耗 Groq 免费额度
            client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1", max_retries=1)
            try:
                with open(audio_path, "rb") as f:
                    resp = client.audio.transcriptions.create(
                        file=f,
                        model="whisper-large-v3",
                        response_format="verbose_json",
                        timestamp_granularities=["segment"],
                        # source_lang 留空（"不确定，自动识别"）时不传 language，让 Whisper 自己检测
                        language=GROQ_LANGUAGE_MAP.get(source_lang),
                    )
            except Exception:
                return self._whisper_failed()

        segments = []
        for seg in getattr(resp, "segments", None) or []:
            text = (seg.text if hasattr(seg, "text") else seg.get("text", "")).strip()
            if not text:
                continue
            start = seg.start if hasattr(seg, "start") else seg.get("start", 0)
            end = seg.end if hasattr(seg, "end") else seg.get("end", 0)
            segments.append({"start": round(start, 2), "end": round(end, 2), "text": text})

        if not segments:
            return None

        return {
            "has_subtitle": True,
            "language": getattr(resp, "language", "") or source_lang,
            "subtitle_type": "whisper",
            "segments": segments,
            "full_text": _build_full_text(segments),
        }

    @staticmethod
    def _download_audio(url: str, tmp_dir: str) -> Optional[str]:
        """下载视频音轨，有 ffmpeg 就顺便转成低码率 mp3（省体积、更容易压到 25MB 免费上限内）"""
        from downloader import _find_ffmpeg_path, _proxy_opts

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "bestaudio/best",
            "outtmpl": os.path.join(tmp_dir, "audio.%(ext)s"),
            **_proxy_opts(url),
        }
        ffmpeg_path = _find_ffmpeg_path()
        if ffmpeg_path:
            ydl_opts["ffmpeg_location"] = ffmpeg_path
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
            }]
            # 单声道 + 24kbps：语音转录场景不需要立体声/高码率，这样压出来的文件小得多——
            # Pro 档 120 分钟音频约 21.6MB，能留出余量不撞上 GROQ_MAX_AUDIO_BYTES（25MB）这个硬上限
            ydl_opts["postprocessor_args"] = {"ffmpeg": ["-ac", "1", "-b:a", "24k"]}

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
        except Exception:
            return None

        files = [f for f in os.listdir(tmp_dir) if f.startswith("audio.")]
        return os.path.join(tmp_dir, files[0]) if files else None

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

            full_text = _build_full_text(segments)
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
        from downloader import _proxy_opts

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "skip_download": True,
            **_proxy_opts(url),
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("无法解析该视频链接")
        return info

    @staticmethod
    def _pick_any_manual_subtitle(manual_subs: dict):
        """自动识别模式下的字幕选择：只挑人工字幕，不管语言是什么，返回 (lang, url, type)"""
        if manual_subs:
            lang = next(iter(manual_subs))
            url = SubtitleExtractor._get_format_url(manual_subs[lang])
            if url:
                return lang, url, "manual"
        return "", None, "none"

    @staticmethod
    def _build_priority(preferred_lang: str) -> list:
        """把请求语言对应的字幕候选插到通用优先级列表前面"""
        candidates = SUPPORTED_LANGUAGES.get(preferred_lang, {}).get("subtitle_candidates", [])
        rest = [lang for lang in SubtitleExtractor.PREFERRED_LANGS if lang not in candidates]
        return candidates + rest

    def _pick_best_subtitle(self, manual_subs: dict, auto_subs: dict, priority: list):
        """按优先级选择最佳字幕，返回 (lang, url, type)"""
        for lang in priority:
            if lang in manual_subs:
                url = self._get_format_url(manual_subs[lang])
                if url:
                    return lang, url, "manual"

        for lang in priority:
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
        from downloader import _proxy_opts

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
                **_proxy_opts(url),
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
        # max_retries=0：关掉 SDK 自带的自动重试，只用下面 _create() 里我们自己写的那层退避重试，
        # 避免两层重试叠加（最坏情况本来会是 我们的3次 × SDK的3次 = 9次真实请求）
        self.client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1", max_retries=0)

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

    def summarize_stream(self, subtitle_text: str, language: str = DEFAULT_LANGUAGE):
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

    def generate_mindmap(self, subtitle_text: str, language: str = DEFAULT_LANGUAGE) -> str:
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

    def chat_stream(self, video_id: str, subtitle_text: str, question: str, language: str = DEFAULT_LANGUAGE, history: list[dict] | None = None):
        """基于视频内容的 AI 问答，流式返回。

        video_id: 字幕缓存/RAG检索用的video_id（"平台:视频ID"，见SubtitleExtractor.get_video_id）。
        短视频直接注入字幕全文时用不上，长视频走RAG检索时用来限定只查这个视频自己的字幕分块，
        不会跨视频检索到不相关内容（见get_video_context）。

        history: 由 chat_history.get_recent_history() 取回的最近几轮对话（[{"role": "user"/"assistant",
        "content": ...}, ...]，旧→新），拼在字幕上下文之后、当前问题之前，让模型能"记住"前几轮聊了什么。
        字幕内容只在第一条 user 消息里出现一次（不随每轮历史重复），避免大段字幕文本被重复计入 token。
        """
        context, _mode = get_video_context(video_id, question, subtitle_text)
        messages = [
            {"role": "system", "content": SUBTITLE_CHAT_SYSTEM_PROMPT},
            {"role": "user", "content": self._build_chat_context_prompt(context)},
        ]
        messages.extend(history or [])
        messages.append({"role": "user", "content": question})

        response = self._create(
            messages=messages,
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
        cfg = _get_language_config(language)
        h = cfg["headers"]
        return f"""请对以下视频字幕内容进行深度总结分析，使用{cfg['name']}输出。

要求输出格式：
## {h['overview']}
（用2-3句话概括视频的主题和核心内容）

## {h['outline']}
（按视频内容的逻辑顺序，列出主要章节/段落，每个章节包含要点）

## {h['keypoints']}
（提取视频中最重要的知识点、观点或结论，用编号列表形式）

## {h['summary']}
（用1-2句话给出整体评价或一句话总结）

---
视频字幕内容：
{truncated}"""

    @staticmethod
    def _build_mindmap_prompt(subtitle_text: str, language: str) -> str:
        truncated = subtitle_text[:15000]
        cfg = _get_language_config(language)
        return f"""请将以下视频字幕内容整理为思维导图结构，使用{cfg['name']}输出。

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
    def _build_chat_context_prompt(context: str) -> str:
        # 只放字幕内容，不再拼问题——问题和历史对话现在都是独立的 message（见 chat_stream），
        # 这条消息只起"给模型看一遍字幕"的作用，同一轮对话里只出现这一次。
        # context 已经是get_video_context处理好的内容（短视频是完整字幕，长视频是RAG
        # 检索出的相关片段拼接），不再在这里做字符截断——截断/检索的判断已经做过了
        return f"""以下是一个视频的字幕内容，请根据这些内容回答我接下来的问题。

视频字幕内容：
{context}"""


def _time_to_seconds(time_str: str) -> float:
    """将 HH:MM:SS.mmm 转为秒数"""
    parts = time_str.split(":")
    hours = int(parts[0])
    minutes = int(parts[1])
    seconds = float(parts[2])
    return hours * 3600 + minutes * 60 + seconds
