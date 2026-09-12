/**
 * FAQ 智能问答（QA agent）API 封装（对应任务4 `POST /api/faq/chat`）
 * 后端任务4还在开发中，请求/返回格式按《RAG功能设计文档.md》假设实现：
 * SSE 流式返回，事件名沿用现有 /api/chat 的约定（answer / done / error）。
 */

import { authHeaders } from './auth'
import { handleSSEStream } from './summarize'

export async function faqChat(question, isFirstTurn, language, callbacks = {}) {
  const response = await fetch('/api/faq/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ question, is_first_turn: isFirstTurn, language }),
  })
  if (!response.ok) throw new Error('FAQ_CHAT_REQUEST_FAILED')
  await handleSSEStream(response, callbacks)
}
