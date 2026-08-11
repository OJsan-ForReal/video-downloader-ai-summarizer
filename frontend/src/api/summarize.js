/**
 * AI 视频总结 API 封装
 * 使用原生 fetch + ReadableStream 处理 SSE 流式响应（POST 带 body，不能用 EventSource）
 */

import { authHeaders } from './auth'

async function handleSSEStream(response, callbacks) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let dataLines = []
  let hasData = false

  function dispatch() {
    if (hasData && currentEvent) {
      const handler = callbacks[currentEvent]
      if (handler) handler(dataLines.join('\n'))
    }
    dataLines = []
    hasData = false
    currentEvent = ''
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line === '') {
        dispatch()
        continue
      }
      if (line.startsWith(':')) continue

      const colonIdx = line.indexOf(':')
      if (colonIdx < 0) continue

      const field = line.slice(0, colonIdx)
      let val = line.slice(colonIdx + 1)
      if (val.startsWith(' ')) val = val.slice(1)

      if (field === 'event') {
        currentEvent = val
      } else if (field === 'data') {
        hasData = true
        dataLines.push(val)
      }
    }
  }
  dispatch()
}

export async function getQuota() {
  const response = await fetch('/api/quota', { headers: authHeaders() })
  if (!response.ok) throw new Error('QUOTA_FETCH_FAILED')
  return response.json()
}

export async function summarizeVideo(url, { language = 'zh-Hans', sourceLanguage = '' } = {}, callbacks = {}) {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url, language, source_language: sourceLanguage }),
  })
  if (!response.ok) throw new Error('SUMMARIZE_REQUEST_FAILED')
  await handleSSEStream(response, callbacks)
}

export async function chatWithVideo(url, question, subtitleText = '', { language = 'zh-Hans', sourceLanguage = '' } = {}, callbacks = {}) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ url, question, subtitle_text: subtitleText, language, source_language: sourceLanguage }),
  })
  if (!response.ok) throw new Error('CHAT_REQUEST_FAILED')
  await handleSSEStream(response, callbacks)
}
