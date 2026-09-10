import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { marked } from 'marked'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { FileText, Captions, Network, MessageCircle, Sparkles, Wand2 } from 'lucide-react'
import { summarizeVideo, chatWithVideo, getChatHistory, getQuota } from '../api/summarize'
import { useLangPath } from '../i18n/langPath'
import { getAnonymousSessionId } from '../utils/session'

marked.setOptions({ breaks: true, gfm: true })

// 支持的语言，要加新语言在这里加一项即可（要跟后端 summarizer.py 的 SUPPORTED_LANGUAGES 对上）
// 这是"AI 总结输出用什么语言"的业务参数，跟界面 UI 语言是两回事，选项文案不跟随 UI 语言翻译
const LANGUAGES = [
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
]

// 视频原语言：多一个"自动识别"选项，留空传给后端表示不确定，交给 Whisper 自己判断
const SOURCE_LANGUAGES = [{ code: '', label: '自动识别' }, ...LANGUAGES]

function LanguageField({ label, value, onChange, disabled, options, size = 'sm' }) {
  const isLg = size === 'lg'
  return (
    <label className={`flex ${isLg ? 'flex-col gap-1.5' : 'items-center gap-2'}`}>
      <span className={isLg ? 'text-xs font-medium uppercase tracking-wide text-slate-400' : 'text-sm text-slate-500'}>
        {label}
      </span>
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`appearance-none rounded-lg border border-slate-200 bg-white font-medium text-slate-700 transition-colors hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 disabled:cursor-not-allowed disabled:opacity-50 ${
            isLg ? 'py-2.5 pl-3.5 pr-9 text-sm w-44' : 'py-1.5 pl-3 pr-8 text-sm'
          }`}
        >
          {options.map((opt) => (
            <option key={opt.code} value={opt.code}>{opt.label}</option>
          ))}
        </select>
        <svg
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400 ${isLg ? 'right-3 h-4 w-4' : 'right-2.5 h-3.5 w-3.5'}`}
          viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5l5 5 5-5" />
        </svg>
      </span>
    </label>
  )
}

function QuotaDots({ remaining, limit }) {
  if (remaining === null) return null
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: limit }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full transition-colors ${i < remaining ? 'bg-teal-500' : 'bg-slate-200'}`}
        />
      ))}
    </div>
  )
}

function StartScreen({ sourceLanguage, setSourceLanguage, language, setLanguage, onStart, quotaRemaining, quotaLimit }) {
  const { t } = useTranslation()
  const exhausted = quotaRemaining === 0
  return (
    <div className="flex flex-col items-center gap-7 px-6 py-16 text-center sm:px-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50">
        <Wand2 className="h-7 w-7 text-teal-600" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{t('summary.startTitle')}</h3>
        <p className="mt-1.5 text-sm text-slate-500">{t('summary.startSubtitle')}</p>
      </div>

      <div className="flex flex-wrap items-start justify-center gap-6">
        <LanguageField
          label={t('summary.sourceLanguageLabel')}
          value={sourceLanguage}
          onChange={setSourceLanguage}
          options={SOURCE_LANGUAGES}
          size="lg"
        />
        <LanguageField
          label={t('summary.summaryLanguageLabel')}
          value={language}
          onChange={setLanguage}
          options={LANGUAGES}
          size="lg"
        />
      </div>

      {exhausted ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-7 py-3 text-sm font-medium text-amber-700">
          {t('summary.quotaExhausted')}
        </div>
      ) : (
        <button
          onClick={onStart}
          className="flex items-center gap-2 rounded-xl bg-teal-600 px-7 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-700 hover:shadow-md active:scale-[0.98]"
        >
          <Sparkles className="h-4 w-4" />
          {t('summary.start')}
        </button>
      )}

      {quotaRemaining !== null && (
        <div className="flex flex-col items-center gap-1.5">
          <QuotaDots remaining={quotaRemaining} limit={quotaLimit} />
          <p className="text-xs text-slate-400">
            {t('summary.quotaRemainingHint', { remaining: quotaRemaining, limit: quotaLimit })}
          </p>
        </div>
      )}
    </div>
  )
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function formatVttTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function segmentsToSrt(segments) {
  return segments.map((seg, i) => {
    return `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}\n`
  }).join('\n')
}

function segmentsToVtt(segments) {
  const body = segments.map((seg) => {
    return `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${seg.text}\n`
  }).join('\n')
  return 'WEBVTT\n\n' + body
}

function segmentsToTxt(segments) {
  return segments.map((seg) => seg.text).join('\n')
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 任务5：AI 回答里如果引用了时间点（比如"03:12"或"1:02:03"），用 teal 色高亮标出来，
// 让用户在视觉上能一眼识别出这是个时间点。在 marked.parse() 之前对原始文本做替换——
// marked 默认不会转义源文本里已经写好的行内 HTML，替换出来的 <span> 能正常穿透渲染。
function highlightTimestamps(text) {
  return text.replace(/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/g, (match) => `<span class="text-teal-600 font-semibold">${match}</span>`)
}

export default function SummaryPanel({ videoUrl, videoTitle }) {
  const { t } = useTranslation()
  const lp = useLangPath()

  const TABS = [
    { key: 'summary', label: t('summary.tabSummary'), icon: FileText },
    { key: 'subtitle', label: t('summary.tabSubtitle'), icon: Captions },
    { key: 'mindmap', label: t('summary.tabMindmap'), icon: Network },
    { key: 'qa', label: t('summary.tabQa'), icon: MessageCircle },
  ]

  const SUBTITLE_FORMATS = [
    { key: 'srt', label: t('summary.subtitleFormatSrt'), ext: 'srt' },
    { key: 'vtt', label: t('summary.subtitleFormatVtt'), ext: 'vtt' },
    { key: 'txt', label: t('summary.subtitleFormatTxt'), ext: 'txt' },
  ]

  function getSafeFilename(title) {
    return (title || t('summary.defaultVideoTitle')).replace(/[\\/*?:"<>|]/g, '_').substring(0, 80)
  }

  const [started, setStarted] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')
  const [language, setLanguage] = useState('en')
  const [sourceLanguage, setSourceLanguage] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(t('summary.loadingExtractSubtitle'))

  // 今日剩余 AI 额度（总结+问答共用），null = 还没查到
  const [quotaRemaining, setQuotaRemaining] = useState(null)
  const [quotaLimit, setQuotaLimit] = useState(3)

  const refreshQuota = useCallback(() => {
    getQuota()
      .then((q) => { setQuotaRemaining(q.remaining); setQuotaLimit(q.limit) })
      .catch(() => { /* 查额度失败不影响主流程，静默忽略 */ })
  }, [])

  useEffect(() => { refreshQuota() }, [refreshQuota])

  const [summaryText, setSummaryText] = useState('')
  const [subtitleData, setSubtitleData] = useState({ segments: [], has_subtitle: false })
  const [subtitleExpanded, setSubtitleExpanded] = useState(false)
  const [showSubtitleDropdown, setShowSubtitleDropdown] = useState(false)

  const [mindmapMarkdown, setMindmapMarkdown] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mindmapContainerRef = useRef(null)
  const mindmapSvgRef = useRef(null)
  const markmapInstanceRef = useRef(null)

  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatContainerRef = useRef(null)
  const subtitleDropdownRef = useRef(null)

  // 任务6：未登录用户的匿名 session_id，用于关联这个视频的历史对话记录（已登录用户走 user.id，
  // 后端自己判断优先用哪个，前端始终把这个值带上就行）
  const sessionId = getAnonymousSessionId()

  const renderMarkdown = useCallback((text) => (text ? marked.parse(text) : ''), [])

  const renderMindmap = useCallback((md) => {
    if (!mindmapSvgRef.current) return
    try {
      mindmapSvgRef.current.innerHTML = ''
      const transformer = new Transformer()
      const { root } = transformer.transform(md)
      markmapInstanceRef.current = Markmap.create(mindmapSvgRef.current, { autoFit: true }, root)
    } catch (e) {
      console.warn('思维导图渲染失败:', e)
    }
  }, [])

  useEffect(() => {
    // 必须等思维导图这个 Tab 真正可见（容器有宽高）才能渲染，
    // 不然 markmap 用零宽高计算自适应缩放会得到 NaN，画出一片空白
    if (mindmapMarkdown && activeTab === 'mindmap') {
      requestAnimationFrame(() => renderMindmap(mindmapMarkdown))
    }
  }, [mindmapMarkdown, activeTab, renderMindmap])

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement)
      requestAnimationFrame(() => markmapInstanceRef.current?.fit())
    }
    function onClickOutside(e) {
      if (subtitleDropdownRef.current && !subtitleDropdownRef.current.contains(e.target)) {
        setShowSubtitleDropdown(false)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('click', onClickOutside)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('click', onClickOutside)
    }
  }, [])

  useEffect(() => {
    if (!started) return
    let cancelled = false

    async function startSummarize() {
      setLoading(true)
      setSummaryText('')
      setMindmapMarkdown('')
      setLoadingMessage(t('summary.loadingExtractSubtitle'))

      try {
        await summarizeVideo(videoUrl, { language, sourceLanguage }, {
          subtitle: (data) => {
            if (cancelled) return
            try {
              const parsed = JSON.parse(data)
              setSubtitleData(parsed)
              if (parsed.has_subtitle) setLoadingMessage(t('summary.loadingAnalyzing'))
            } catch { /* ignore */ }
          },
          summary: (data) => {
            if (cancelled) return
            try { setSummaryText((prev) => prev + JSON.parse(data)) } catch { setSummaryText((prev) => prev + data) }
          },
          mindmap: (data) => {
            if (cancelled) return
            try { setMindmapMarkdown(JSON.parse(data).markdown || '') } catch { /* ignore */ }
          },
          done: () => { if (!cancelled) { setLoading(false); refreshQuota() } },
          error: (data) => {
            if (cancelled) return
            setLoading(false)
            refreshQuota()
            try {
              const parsed = JSON.parse(data)
              alert(parsed.message || t('summary.summarizeFailedGeneric'))
            } catch {
              alert(t('summary.summarizeFailedWithMessage', { message: data }))
            }
          },
        })
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          alert(t('summary.summarizeRequestFailedWithMessage', { message: t('errors.' + err.message, err.message) }))
        }
      }
    }

    startSummarize()
    return () => { cancelled = true }
  }, [started, videoUrl, language, sourceLanguage, refreshQuota, t])

  // 任务6：面板打开后拉一次这个视频之前问过的历史对话，展示在问答 Tab 里。
  // 后端任务6的历史接口还没部署，请求失败/404 时 getChatHistory 静默返回空数组，不影响使用。
  useEffect(() => {
    if (!started) return
    let cancelled = false
    getChatHistory(videoUrl, sessionId).then((history) => {
      if (cancelled || history.length === 0) return
      setChatMessages((prev) => (prev.length === 0 ? history.map((h) => ({ role: h.role, content: h.content })) : prev))
    }).catch(() => { /* 历史记录拉取失败不影响主流程，静默忽略 */ })
    return () => { cancelled = true }
  }, [started, videoUrl, sessionId])

  function toggleFullscreen() {
    if (!mindmapContainerRef.current) return
    if (!isFullscreen) {
      mindmapContainerRef.current.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

  function buildExportableSvg() {
    if (!mindmapSvgRef.current) return null
    const cloned = mindmapSvgRef.current.cloneNode(true)

    // 保险：万一残留了 NaN transform（比如切 Tab 时机不巧），导出前强制归零，避免整张图跑到取景框外面
    cloned.querySelectorAll('[transform]').forEach((el) => {
      const t = el.getAttribute('transform')
      if (t && t.includes('NaN')) {
        el.setAttribute('transform', 'translate(0,0) scale(1)')
      }
    })

    cloned.querySelectorAll('foreignObject').forEach((fo) => {
      const textContent = fo.textContent?.trim() || ''
      if (!textContent) { fo.remove(); return }
      const x = parseFloat(fo.getAttribute('x')) || 0
      const y = parseFloat(fo.getAttribute('y')) || 0
      const h = parseFloat(fo.getAttribute('height')) || 20
      const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      textEl.setAttribute('x', String(x + 4))
      textEl.setAttribute('y', String(y + h / 2 + 5))
      textEl.setAttribute('font-size', '14')
      textEl.setAttribute('font-family', 'sans-serif')
      textEl.setAttribute('fill', '#333')
      textEl.setAttribute('dominant-baseline', 'middle')
      textEl.textContent = textContent
      fo.parentNode.replaceChild(textEl, fo)
    })
    return cloned
  }

  function getContentBBox() {
    const svgEl = mindmapSvgRef.current
    const gRoot = svgEl?.querySelector('g')
    if (gRoot) {
      try {
        const bbox = gRoot.getBBox()
        if (bbox.width > 0 && bbox.height > 0) {
          // getBBox() 返回的是 <g> 自身 transform 生效之前的本地坐标，
          // markmap 会给这个 <g> 加 translate+scale 做自适应，这里要把这个变换换算回去，
          // 不然算出来的取景框跟内容实际所在位置对不上，导出就是一片空白
          const transform = gRoot.getAttribute('transform') || ''
          const translateMatch = transform.match(/translate\(\s*([-\d.e]+)\s*[,\s]\s*([-\d.e]+)\s*\)/)
          const scaleMatch = transform.match(/scale\(\s*([-\d.e]+)/)
          const tx = translateMatch ? parseFloat(translateMatch[1]) : 0
          const ty = translateMatch ? parseFloat(translateMatch[2]) : 0
          const sc = scaleMatch ? parseFloat(scaleMatch[1]) : 1
          return {
            x: bbox.x * sc + tx,
            y: bbox.y * sc + ty,
            width: bbox.width * sc,
            height: bbox.height * sc,
          }
        }
      } catch { /* ignore */ }
    }
    try {
      const bbox = svgEl.getBBox()
      if (bbox.width > 0 && bbox.height > 0) return bbox
    } catch { /* ignore */ }
    return { x: 0, y: 0, width: 800, height: 600 }
  }

  function setFullViewBox(svgClone) {
    const dims = getContentBBox()
    const padding = 60
    const vx = dims.x - padding
    const vy = dims.y - padding
    const vw = dims.width + padding * 2
    const vh = dims.height + padding * 2
    svgClone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`)
    svgClone.setAttribute('width', String(vw))
    svgClone.setAttribute('height', String(vh))
    return { vw, vh }
  }

  function serializeSvg(svgEl) {
    // markmap-view 会把自己需要的样式以 <style> 的形式直接塞进 SVG 内部（不是挂在页面全局），
    // cloneNode(true) 已经把这份样式带过去了，不需要再去页面上找其它 <style> 标签抄一遍——
    // 之前这么做过，结果连 Tailwind 编译出来的整个样式表都被误抄进去，把 SVG 解析搞挂了
    let svgString = new XMLSerializer().serializeToString(svgEl)
    if (!svgString.includes('xmlns=')) {
      svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    return svgString
  }

  async function downloadMindmapPng() {
    const exportSvg = buildExportableSvg()
    if (!exportSvg) return
    const { vw, vh } = setFullViewBox(exportSvg)
    const scale = Math.max(4, Math.ceil(3840 / vw))
    const svgString = serializeSvg(exportSvg)

    const canvas = document.createElement('canvas')
    canvas.width = vw * scale
    canvas.height = vh * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        canvas.toBlob((pngBlob) => {
          if (pngBlob) triggerDownload(pngBlob, getSafeFilename(videoTitle) + t('summary.mindmapFileSuffix') + '.png')
          resolve()
        }, 'image/png')
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        alert(t('summary.pngExportFailed'))
        resolve()
      }
      img.src = url
    })
  }

  function downloadMindmapSvg() {
    if (!mindmapSvgRef.current) return
    const cloned = mindmapSvgRef.current.cloneNode(true)
    cloned.querySelectorAll('[transform]').forEach((el) => {
      const t = el.getAttribute('transform')
      if (t && t.includes('NaN')) {
        el.setAttribute('transform', 'translate(0,0) scale(1)')
      }
    })
    setFullViewBox(cloned)
    const svgString = serializeSvg(cloned)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    triggerDownload(blob, getSafeFilename(videoTitle) + t('summary.mindmapFileSuffix') + '.svg')
  }

  function downloadSubtitle(format) {
    setShowSubtitleDropdown(false)
    const segments = subtitleData.segments
    if (!segments || segments.length === 0) return

    let content = ''
    if (format === 'srt') content = segmentsToSrt(segments)
    else if (format === 'vtt') content = segmentsToVtt(segments)
    else content = segmentsToTxt(segments)

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    triggerDownload(blob, `${getSafeFilename(videoTitle)}${t('summary.subtitleFileSuffix')}.${format}`)
  }

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
      }
    })
  }

  async function sendQuestion() {
    const question = chatInput.trim()
    if (!question || chatLoading) return

    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: question }])
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '', loading: true }])
    setChatLoading(true)
    scrollChatToBottom()

    function updateLastMessage(updater) {
      setChatMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = updater(next[next.length - 1])
        return next
      })
    }

    try {
      await chatWithVideo(videoUrl, question, subtitleData.full_text || '', { language, sourceLanguage, sessionId }, {
        answer: (data) => {
          let token = data
          try { token = JSON.parse(data) } catch { /* raw */ }
          updateLastMessage((m) => ({ ...m, content: m.content + token }))
          scrollChatToBottom()
        },
        done: () => {
          updateLastMessage((m) => ({ ...m, loading: false }))
          setChatLoading(false)
          refreshQuota()
        },
        error: (data) => {
          let message = t('summary.answerFailed')
          try { message = JSON.parse(data).message || message } catch { /* ignore */ }
          updateLastMessage((m) => ({ ...m, content: '❌ ' + message, loading: false }))
          setChatLoading(false)
          refreshQuota()
        },
      })
    } catch (err) {
      updateLastMessage((m) => ({
        ...m,
        content: '❌ ' + t('summary.requestFailedWithMessage', { message: t('errors.' + err.message, err.message) }),
        loading: false,
      }))
      setChatLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {!started ? (
        <StartScreen
          sourceLanguage={sourceLanguage}
          setSourceLanguage={setSourceLanguage}
          language={language}
          setLanguage={setLanguage}
          onStart={() => setStarted(true)}
          quotaRemaining={quotaRemaining}
          quotaLimit={quotaLimit}
        />
      ) : (
      <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <LanguageField
            label={t('summary.sourceLanguageLabel')}
            value={sourceLanguage}
            onChange={setSourceLanguage}
            disabled={loading}
            options={SOURCE_LANGUAGES}
          />
          <LanguageField
            label={t('summary.summaryLanguageLabel')}
            value={language}
            onChange={setLanguage}
            disabled={loading}
            options={LANGUAGES}
          />
        </div>
        {quotaRemaining !== null && (
          <div className="flex items-center gap-1.5" title={t('summary.quotaRemainingHint', { remaining: quotaRemaining, limit: quotaLimit })}>
            <QuotaDots remaining={quotaRemaining} limit={quotaLimit} />
            <span className="text-xs text-slate-400">{t('summary.quotaRemainingShort', { remaining: quotaRemaining })}</span>
          </div>
        )}
      </div>

      <div className="flex border-b border-slate-100">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium relative transition-colors ${
              activeTab === tab.key ? 'text-teal-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            <span>{tab.label}</span>
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600" />
            )}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6 min-h-[400px]">
        {loading && !summaryText && activeTab === 'summary' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin mb-4" />
            <p className="text-slate-500 text-sm">{loadingMessage}</p>
          </div>
        )}

        {/* 总结摘要 */}
        <div style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
          {summaryText && (
            <div
              className="prose prose-slate max-w-none prose-headings:font-semibold prose-p:leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(summaryText) }}
            />
          )}
          {loading && summaryText && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-pulse" />
              {t('summary.generatingMore')}
            </div>
          )}
        </div>

        {/* 字幕文本 */}
        <div style={{ display: activeTab === 'subtitle' ? 'block' : 'none' }}>
          {subtitleData.segments && subtitleData.segments.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-slate-500">
                  {t('summary.subtitleCount', { count: subtitleData.segments.length })}
                  {subtitleData.language && (
                    <span className="ml-2 px-2 py-0.5 bg-teal-50 text-teal-600 rounded-full text-xs">
                      {subtitleData.subtitle_type === 'manual'
                        ? t('summary.subtitleTypeManual')
                        : subtitleData.subtitle_type === 'whisper'
                          ? t('summary.subtitleTypeWhisper')
                          : t('summary.subtitleTypeAuto')} · {subtitleData.language}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative" ref={subtitleDropdownRef}>
                    <button
                      onClick={() => setShowSubtitleDropdown((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 px-2.5 py-1.5 rounded-lg hover:bg-teal-50 transition-colors"
                    >
                      {t('summary.downloadSubtitle')}
                    </button>
                    {showSubtitleDropdown && (
                      <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-10 min-w-[120px]">
                        {SUBTITLE_FORMATS.map((fmt) => (
                          <button
                            key={fmt.key}
                            onClick={() => downloadSubtitle(fmt.key)}
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-between"
                          >
                            <span>{fmt.label}</span>
                            <span className="text-slate-400">.{fmt.ext}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setSubtitleExpanded((v) => !v)}
                    className="text-xs text-teal-600 hover:text-teal-700"
                  >
                    {subtitleExpanded ? t('summary.collapse') : t('summary.expand')}
                  </button>
                </div>
              </div>
              <div className={`space-y-1 overflow-y-auto ${subtitleExpanded ? 'max-h-none' : 'max-h-[500px]'}`}>
                {subtitleData.segments.map((seg, idx) => (
                  <div key={idx} className="flex gap-3 py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
                    <span className="flex-shrink-0 text-xs text-teal-600 font-mono pt-0.5 min-w-[60px]">
                      {formatTime(seg.start)}
                    </span>
                    <span className="text-base text-slate-700 leading-relaxed">{seg.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <p className="text-base text-center">
                {subtitleData.subtitle_type === 'too_long'
                  ? t('summary.subtitleTooLong', { minutes: subtitleData.duration_minutes })
                  : t('summary.noSubtitle')}
              </p>
              {subtitleData.subtitle_type === 'too_long' && subtitleData.upgrade_hint && (
                <Link
                  to={lp('/pricing')}
                  className="mt-4 rounded-full bg-teal-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
                >
                  {t('summary.upgradeToPro')}
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin mb-3" />
              <p className="text-slate-400 text-sm">{t('summary.extractingSubtitle')}</p>
            </div>
          )}
        </div>

        {/* 思维导图 */}
        <div style={{ display: activeTab === 'mindmap' ? 'block' : 'none' }}>
          {mindmapMarkdown ? (
            <div className="relative">
              <div className="flex items-center justify-end gap-2 mb-3">
                <button onClick={downloadMindmapPng} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition-colors">
                  PNG
                </button>
                <button onClick={downloadMindmapSvg} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition-colors">
                  SVG
                </button>
                <button onClick={toggleFullscreen} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition-colors">
                  {isFullscreen ? t('summary.exitFullscreen') : t('summary.fullscreen')}
                </button>
              </div>
              <div
                ref={mindmapContainerRef}
                className={`mindmap-wrapper w-full border border-slate-200 rounded-xl bg-white overflow-hidden ${isFullscreen ? 'fixed inset-0 z-40 rounded-none border-none' : 'min-h-[500px]'}`}
              >
                <svg ref={mindmapSvgRef} className="w-full h-full" style={{ minHeight: isFullscreen ? '100%' : '500px' }} />
                {isFullscreen && (
                  <button
                    onClick={toggleFullscreen}
                    className="fixed top-4 right-4 z-50 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/90 backdrop-blur shadow-lg text-sm text-slate-700 hover:bg-white transition-colors border border-slate-200"
                  >
                    {t('summary.exitFullscreen')}
                  </button>
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin mb-3" />
              <p className="text-slate-400 text-sm">{t('summary.mindmapGenerating')}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <p className="text-sm">{t('summary.mindmapNeedSummaryFirst')}</p>
            </div>
          )}
        </div>

        {/* AI 问答 */}
        <div style={{ display: activeTab === 'qa' ? 'block' : 'none' }}>
          <div className="space-y-4">
            <div ref={chatContainerRef} className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <p className="text-sm mb-1">{t('summary.qaEmptyHint')}</p>
                  <p className="text-xs">{t('summary.qaEmptyExample')}</p>
                </div>
              )}
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-base leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-teal-600 text-white rounded-br-md'
                        : 'bg-slate-50 text-slate-800 rounded-bl-md border border-slate-100'
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
                          className="prose prose-slate max-w-none prose-p:leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(highlightTimestamps(msg.content)) }}
                        />
                      )
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {quotaRemaining === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-700">
                {t('summary.quotaExhausted')}
              </div>
            ) : (
              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendQuestion() } }}
                  type="text"
                  placeholder={t('summary.qaInputPlaceholder')}
                  disabled={chatLoading}
                  className="flex-1 h-11 px-4 rounded-xl border border-slate-200 bg-white text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 transition-all"
                />
                <button
                  onClick={sendQuestion}
                  disabled={!chatInput.trim() || chatLoading}
                  className="h-11 px-5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('summary.send')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
}
