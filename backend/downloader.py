import os
import re
import shutil
import uuid
from typing import Optional
from urllib.parse import urlparse

import yt_dlp

# 这几个平台在云服务器机房IP上会被反爬拦截，需要走代理绕一下（走自建的反向隧道代理，
# 见 自己学习开发/每阶段txt记录文件/ 里的说明），其他平台数据中心IP直连没问题，不用额外绕路
PROXY_REQUIRED_HOSTS = ("youtube.com", "youtu.be", "bilibili.com", "b23.tv")


def _needs_proxy(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return any(host == h or host.endswith("." + h) for h in PROXY_REQUIRED_HOSTS)


def _proxy_opts(url: str) -> dict:
    proxy = os.getenv("YT_DLP_PROXY")
    if not proxy or not _needs_proxy(url):
        return {}
    # 代理走的是家里临时开的隧道，随时可能没开着，给个短超时，别让请求一直卡住
    return {"proxy": proxy, "socket_timeout": 15}


def _find_ffmpeg_path() -> Optional[str]:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return os.path.dirname(ffmpeg)
    try:
        import static_ffmpeg
        paths = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
        return os.path.dirname(paths[0])
    except Exception:
        return None


class VideoDownloader:
    """yt-dlp 封装层：解析视频信息、服务端下载（视频+音频/仅视频/仅音频）"""

    DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "downloads")

    def __init__(self):
        os.makedirs(self.DOWNLOAD_DIR, exist_ok=True)
        self.ffmpeg_path = _find_ffmpeg_path()
        self.has_ffmpeg = self.ffmpeg_path is not None

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        return re.sub(r'[\\/*?:"<>|]', "_", name)

    @staticmethod
    def _format_duration(seconds: Optional[int]) -> str:
        if not seconds:
            return "00:00"
        hours, remainder = divmod(int(seconds), 3600)
        minutes, secs = divmod(remainder, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes}:{secs:02d}"

    def parse_video(self, url: str) -> dict:
        """解析视频信息，不下载文件"""
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            **_proxy_opts(url),
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            raise ValueError("无法解析该链接")

        return {
            "id": info.get("id", ""),
            "title": info.get("title", "未知标题"),
            "thumbnail": info.get("thumbnail", ""),
            "duration": info.get("duration"),
            "duration_string": self._format_duration(info.get("duration")),
            "uploader": info.get("uploader", info.get("channel", "未知")),
            "platform": info.get("extractor_key", info.get("extractor", "Unknown")),
            **self._group_formats(info),
        }

    def _group_formats(self, info: dict) -> dict:
        """把 yt-dlp 的格式列表整理成三组：视频+音频 / 仅视频 / 仅音频"""
        raw_formats = info.get("formats", [])

        video_audio, video_only, audio_only = [], [], []
        seen = set()

        for f in raw_formats:
            vcodec = f.get("vcodec", "none")
            acodec = f.get("acodec", "none")
            has_video = bool(vcodec) and vcodec != "none"
            has_audio = bool(acodec) and acodec != "none"
            if not has_video and not has_audio:
                continue

            ext = f.get("ext", "mp4")
            height = f.get("height")
            filesize = f.get("filesize") or f.get("filesize_approx")

            if has_video and has_audio:
                key = ("va", height, ext)
                if key in seen:
                    continue
                seen.add(key)
                video_audio.append({
                    "format_id": f.get("format_id", ""),
                    "ext": ext,
                    "height": height or 0,
                    "label": f"{height}p {ext.upper()}" if height else ext.upper(),
                    "filesize": filesize,
                })
            elif has_video:
                key = ("v", height, ext)
                if key in seen:
                    continue
                seen.add(key)
                video_only.append({
                    "format_id": f.get("format_id", ""),
                    "ext": ext,
                    "height": height or 0,
                    "label": f"{height}p {ext.upper()}" if height else ext.upper(),
                    "filesize": filesize,
                })
            else:
                abr = f.get("abr")
                key = ("a", abr, ext)
                if key in seen:
                    continue
                seen.add(key)
                audio_only.append({
                    "format_id": f.get("format_id", ""),
                    "ext": ext,
                    "abr": abr or 0,
                    "label": f"{int(abr)}kbps {ext.upper()}" if abr else ext.upper(),
                    "filesize": filesize,
                })

        video_audio.sort(key=lambda x: x["height"], reverse=True)
        video_only.sort(key=lambda x: x["height"], reverse=True)
        audio_only.sort(key=lambda x: x["abr"], reverse=True)

        if self.has_ffmpeg and video_only:
            best_video = video_only[0]
            video_audio.insert(0, {
                "format_id": "bestvideo+bestaudio/best",
                "ext": "mp4",
                "height": best_video["height"],
                "label": f"推荐 · {best_video['height']}p 高清（自动合并音频）" if best_video["height"] else "推荐 · 最佳画质",
                "filesize": None,
            })

        return {
            "video_audio_formats": video_audio[:8],
            "video_only_formats": video_only[:8],
            "audio_only_formats": audio_only[:5],
        }

    def download_video(self, url: str, format_id: str) -> dict:
        """服务端下载，支持单一格式或 video+audio 合并格式，返回本地文件路径

        每次下载用独立子目录，避免同一视频不同格式重复下载时文件名冲突、
        被 yt-dlp「文件已存在则跳过」的默认行为吃掉，导致返回旧格式的文件。
        """
        if not self.has_ffmpeg and "+" in format_id:
            format_id = "best"

        task_dir = os.path.join(self.DOWNLOAD_DIR, uuid.uuid4().hex)
        os.makedirs(task_dir, exist_ok=True)

        ydl_opts = {
            "format": format_id,
            "outtmpl": os.path.join(task_dir, "%(title)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            **_proxy_opts(url),
        }
        if self.has_ffmpeg:
            ydl_opts["ffmpeg_location"] = self.ffmpeg_path
            if "+" in format_id:
                ydl_opts["merge_output_format"] = "mp4"

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filepath = ydl.prepare_filename(info)

        if not os.path.exists(filepath):
            # 合并格式后 yt-dlp 可能改变了扩展名，在任务目录里兜底查找唯一文件
            files = os.listdir(task_dir)
            if files:
                filepath = os.path.join(task_dir, files[0])

        if not os.path.exists(filepath):
            raise ValueError("下载失败：文件未生成")

        return {
            "filepath": filepath,
            "filename": os.path.basename(filepath),
            "title": info.get("title", "video"),
        }
