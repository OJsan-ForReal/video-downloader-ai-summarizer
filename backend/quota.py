"""极简的每日额度计数器（内存存储，进程重启即清零）。

现在还没有用户账号系统，没法按登录用户精确计数，只能退而求其次按客户端 IP
粗略区分"谁在用"——这不精确（同一 IP 下多人共享网络会互相影响，比如公司/校园网），
但先把"额度确实在生效"这件事做出来，比完全不限制强。等接入账号系统后，
应该换成按登录用户 ID 计数、存进数据库，并按付费状态取不同的每日额度。
"""

from datetime import date
from threading import Lock

# 对应 Pricing.jsx 里的"AI 总结每日 3 次"——总结（含思维导图）和 AI 问答共用这一份每日额度，
# 每次成功触发总结算 1 次，每问一个问题也算 1 次
FREE_DAILY_LIMIT = 3

_lock = Lock()
_usage: dict[str, tuple[date, int]] = {}


def consume(identifier: str) -> bool:
    """尝试消耗一次额度。额度足够则消耗并返回 True；已用完则不消耗，返回 False"""
    today = date.today()
    with _lock:
        last_date, count = _usage.get(identifier, (today, 0))
        if last_date != today:
            count = 0
        if count >= FREE_DAILY_LIMIT:
            _usage[identifier] = (today, count)
            return False
        _usage[identifier] = (today, count + 1)
        return True


def remaining(identifier: str) -> int:
    """查询今日剩余额度，不消耗"""
    today = date.today()
    with _lock:
        last_date, count = _usage.get(identifier, (today, 0))
        if last_date != today:
            return FREE_DAILY_LIMIT
        return max(0, FREE_DAILY_LIMIT - count)
