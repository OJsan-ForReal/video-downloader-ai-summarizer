"""对话记忆：视频问答的多轮上下文，滑动窗口存取（SQLite，不引入 Redis）。

跟字幕 RAG 检索是两回事——这里不做"把历史问答存进 Chroma 做向量检索"式的长期记忆，
最近 N 条历史窗口对"记住这轮对话聊了什么"这个场景已经够用，也是方案文档定下来的做法。
"""

import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import ChatHistory

DEFAULT_HISTORY_LIMIT = 10


def video_id_for_url(url: str) -> str:
    """对话记忆按视频 URL 哈希区分视频，是独立于 summarizer.py 内部字幕缓存用的
    video_id（"平台:视频ID"）的另一套标识——这个功能不需要知道字幕那边怎么解析ID，
    自己对 URL 算一个稳定 key 就够用了"""
    return hashlib.sha256(url.strip().encode()).hexdigest()


async def append_message(session: AsyncSession, video_id: str, session_id: str, role: str, content: str) -> None:
    """一轮对话记一行：用户提问记一次、AI回答记一次"""
    session.add(ChatHistory(video_id=video_id, session_id=session_id, role=role, content=content))
    await session.commit()


async def get_recent_history(
    session: AsyncSession, video_id: str, session_id: str, limit: int = DEFAULT_HISTORY_LIMIT
) -> list[dict]:
    """取最近 limit 条记录，按发生顺序（旧→新）返回，方便直接接在 prompt 里当作历史消息。

    按 id 倒序取再反转，而不是按 created_at 倒序——同一进程里连续两次 append_message
    的时间戳可能落在同一毫秒，autoincrement 的 id 才是插入顺序的可靠依据。
    """
    result = await session.execute(
        select(ChatHistory)
        .where(ChatHistory.video_id == video_id, ChatHistory.session_id == session_id)
        .order_by(ChatHistory.id.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    rows.reverse()
    return [{"role": r.role, "content": r.content} for r in rows]
