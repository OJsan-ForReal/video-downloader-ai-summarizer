import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircleQuestion, X } from 'lucide-react'
import { marked } from 'marked'
import { faqChat } from '../api/faq'

// 全站悬浮的 FAQ 智能问答入口（对应任务4 QA agent）。放在左下角，跟 FeedbackButton
// 的右下角悬浮按钮对称，避免两个悬浮入口互相遮挡。
export default function FaqChatWidget() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // 这个聊天窗口是不是第一次打开之后发的第一条消息——任务4接口需要，纯前端状态，不持久化
  const [isFirstTurn, setIsFirstTurn] = useState(true)
  const containerRef = useRef(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight
    })
  }, [messages])

  function renderMarkdown(text) {
    return text ? marked.parse(text) : ''
  }

  async function sendQuestion() {
    const question = input.trim()
    if (!question || loading) return

    const firstTurn = isFirstTurn
    setInput('')
    setIsFirstTurn(false)
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setMessages((prev) => [...prev, { role: 'assistant', content: '', loading: true }])
    setLoading(true)

    function updateLastMessage(updater) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = updater(next[next.length - 1])
        return next
      })
    }

    try {
      await faqChat(question, firstTurn, i18n.language, {
        answer: (data) => {
          let token = data
          try { token = JSON.parse(data) } catch { /* raw */ }
          updateLastMessage((m) => ({ ...m, content: m.content + token }))
        },
        done: () => {
          updateLastMessage((m) => ({ ...m, loading: false }))
          setLoading(false)
        },
        error: (data) => {
          let message = t('faq.answerFailed')
          try { message = JSON.parse(data).message || message } catch { /* ignore */ }
          updateLastMessage((m) => ({ ...m, content: '❌ ' + message, loading: false }))
          setLoading(false)
        },
      })
    } catch (err) {
      updateLastMessage((m) => ({
        ...m,
        content: '❌ ' + t('faq.requestFailedWithMessage', { message: t('errors.' + err.message, err.message) }),
        loading: false,
      }))
      setLoading(false)
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed left-4 z-40 flex w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-6"
          style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))', height: 'min(28rem, 70vh)' }}
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-teal-50/60 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{t('faq.title')}</p>
              <p className="text-xs text-slate-500">{t('faq.subtitle')}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label={t('faq.close')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
            >
              <X size={16} />
            </button>
          </div>

          <div ref={containerRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                <p className="text-sm">{t('faq.emptyHint')}</p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'rounded-br-md bg-teal-600 text-white'
                      : 'rounded-bl-md border border-slate-100 bg-slate-50 text-slate-800'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    msg.loading ? (
                      // 后端现在是攒完整回复校验通过才一次性返回（不是逐token流式，见summarizer.py
                      // 的_looks_like_valid_reply），这段等待期间用"正在输入"三点跳动代替旧的
                      // 光标闪烁——旧效果是为逐字流式设计的，内容一次性到达时对不上
                      <div className="flex items-center gap-1 py-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <div
                        className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    )
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-slate-100 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendQuestion() } }}
              type="text"
              placeholder={t('faq.inputPlaceholder')}
              disabled={loading}
              className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 placeholder:text-slate-400 transition-all focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
            />
            <button
              onClick={sendQuestion}
              disabled={!input.trim() || loading}
              className="h-10 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white transition-all hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('faq.send')}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        title={t('faq.entry')}
        aria-label={t('faq.entry')}
        className="fixed left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg transition-all hover:scale-105 hover:bg-teal-700 sm:left-6"
        style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        {open ? <X size={22} /> : <MessageCircleQuestion size={22} />}
      </button>
    </>
  )
}
