/**
 * 未登录用户的匿名会话标识（任务6：对话历史需要按 video_id + session_id 关联）。
 * 已登录用户不需要这个——后端会优先用 user.id 区分身份，这个值只是给匿名访客兜底用的。
 */

const ANONYMOUS_SESSION_KEY = 'anonymous_session_id'

export function getAnonymousSessionId() {
  let id = localStorage.getItem(ANONYMOUS_SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ANONYMOUS_SESSION_KEY, id)
  }
  return id
}
