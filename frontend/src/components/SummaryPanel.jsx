import { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { summarizeVideo, chatWithVideo } from '../api/summarize'

marked.setOptions({ breaks: true, gfm: true })

const TABS = [
  { key: 'summary', label: '总结摘要', icon: '📝' },
  { key: 'subtitle', label: '字幕文本', icon: '📄' },
  { key: 'mindmap', label: '思维导图', icon: '🧠' },
  { key: 'qa', label: 'AI 问答', icon: '💬' },
]

const SUBTITLE_FORMATS = [
  { key: 'srt', label: 'SRT 字幕', ext: 'srt' },
  { key: 'vtt', label: 'VTT 字幕', ext: 'vtt' },
  { key: 'txt', label: '纯文本', ext: 'txt' },
]

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

function getSafeFilename(title) {
  return (title || '视频').replace(/[\\/*?:"<>|]/g, '_').substring(0, 80)
}

export default function SummaryPanel({ videoUrl, videoTitle }) {
  const [activeTab, setActiveTab] = useState('summary')
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('正在提取视频字幕...')

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
    if (mindmapMarkdown) {
      requestAnimationFrame(() => renderMindmap(mindmapMarkdown))
    }
  }, [mindmapMarkdown, renderMindmap])

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
    let cancelled = false

    async function startSummarize() {
      setLoading(true)
      setSummaryText('')
      setMindmapMarkdown('')
      setLoadingMessage('正在提取视频字幕...')

      try {
        await summarizeVideo(videoUrl, 'zh', {
          subtitle: (data) => {
            if (cancelled) return
            try {
              const parsed = JSON.parse(data)
              setSubtitleData(parsed)
              if (parsed.has_subtitle) setLoadingMessage('AI 正在分析视频内容...')
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
          done: () => { if (!cancelled) setLoading(false) },
          error: (data) => {
            if (cancelled) return
            setLoading(false)
            try {
              const parsed = JSON.parse(data)
              alert(parsed.message || '总结失败')
            } catch {
              alert('总结失败: ' + data)
            }
          },
        })
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          alert('总结请求失败: ' + err.message)
        }
      }
    }

    startSummarize()
    return () => { cancelled = true }
  }, [videoUrl])

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
        if (bbox.width > 0 && bbox.height > 0) return bbox
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
          if (pngBlob) triggerDownload(pngBlob, getSafeFilename(videoTitle) + ' - 思维导图.png')
          resolve()
        }, 'image/png')
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        alert('PNG 导出失败，请使用 SVG 下载')
        resolve()
      }
      img.src = url
    })
  }

  function downloadMindmapSvg() {
    if (!mindmapSvgRef.current) return
    const cloned = mindmapSvgRef.current.cloneNode(true)
    setFullViewBox(cloned)
    const svgString = serializeSvg(cloned)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    triggerDownload(blob, getSafeFilename(videoTitle) + ' - 思维导图.svg')
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
    triggerDownload(blob, `${getSafeFilename(videoTitle)} - 字幕.${format}`)
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
      await chatWithVideo(videoUrl, question, subtitleData.full_text || '', {
        answer: (data) => {
          let token = data
          try { token = JSON.parse(data) } catch { /* raw */ }
          updateLastMessage((m) => ({ ...m, content: m.content + token }))
          scrollChatToBottom()
        },
        done: () => {
          updateLastMessage((m) => ({ ...m, loading: false }))
          setChatLoading(false)
        },
        error: (data) => {
          let message = '回答失败'
          try { message = JSON.parse(data).message || message } catch { /* ignore */ }
          updateLastMessage((m) => ({ ...m, content: '❌ ' + message, loading: false }))
          setChatLoading(false)
        },
      })
    } catch (err) {
      updateLastMessage((m) => ({ ...m, content: '❌ 请求失败: ' + err.message, loading: false }))
      setChatLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex border-b border-slate-100">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium relative transition-colors ${
              activeTab === tab.key ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
            )}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6 min-h-[400px]">
        {loading && !summaryText && activeTab === 'summary' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4" />
            <p className="text-slate-500 text-sm">{loadingMessage}</p>
          </div>
        )}

        {/* 总结摘要 */}
        <div style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
          {summaryText && (
            <div
              className="prose prose-sm prose-slate max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(summaryText) }}
            />
          )}
          {loading && summaryText && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" />
              AI 正在生成中...
            </div>
          )}
        </div>

        {/* 字幕文本 */}
        <div style={{ display: activeTab === 'subtitle' ? 'block' : 'none' }}>
          {subtitleData.segments && subtitleData.segments.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-slate-500">
                  共 {subtitleData.segments.length} 条字幕
                  {subtitleData.language && (
                    <span className="ml-2 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">
                      {subtitleData.subtitle_type === 'manual' ? '人工字幕' : '自动字幕'} · {subtitleData.language}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative" ref={subtitleDropdownRef}>
                    <button
                      onClick={() => setShowSubtitleDropdown((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      下载字幕
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
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    {subtitleExpanded ? '收起' : '展开全部'}
                  </button>
                </div>
              </div>
              <div className={`space-y-1 overflow-y-auto ${subtitleExpanded ? 'max-h-none' : 'max-h-[500px]'}`}>
                {subtitleData.segments.map((seg, idx) => (
                  <div key={idx} className="flex gap-3 py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
                    <span className="flex-shrink-0 text-xs text-blue-600 font-mono pt-0.5 min-w-[60px]">
                      {formatTime(seg.start)}
                    </span>
                    <span className="text-sm text-slate-700 leading-relaxed">{seg.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <p className="text-sm">该视频暂无可用字幕</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-3" />
              <p className="text-slate-400 text-sm">正在提取字幕...</p>
            </div>
          )}
        </div>

        {/* 思维导图 */}
        <div style={{ display: activeTab === 'mindmap' ? 'block' : 'none' }}>
          {mindmapMarkdown ? (
            <div className="relative">
              <div className="flex items-center justify-end gap-2 mb-3">
                <button onClick={downloadMindmapPng} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
                  PNG
                </button>
                <button onClick={downloadMindmapSvg} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
                  SVG
                </button>
                <button onClick={toggleFullscreen} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
                  {isFullscreen ? '退出全屏' : '全屏'}
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
                    退出全屏
                  </button>
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-3" />
              <p className="text-slate-400 text-sm">正在生成思维导图...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <p className="text-sm">请先生成总结以查看思维导图</p>
            </div>
          )}
        </div>

        {/* AI 问答 */}
        <div style={{ display: activeTab === 'qa' ? 'block' : 'none' }}>
          <div className="space-y-4">
            <div ref={chatContainerRef} className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
              {chatMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <p className="text-sm mb-1">向 AI 提问关于这个视频的任何问题</p>
                  <p className="text-xs">例如："这个视频的核心观点是什么？"</p>
                </div>
              )}
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-slate-50 text-slate-800 rounded-bl-md border border-slate-100'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    ) : (
                      <span>{msg.content}</span>
                    )}
                    {msg.role === 'assistant' && msg.loading && (
                      <span className="inline-block w-1.5 h-4 bg-blue-400 rounded-sm animate-pulse ml-0.5 align-text-bottom" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-100">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendQuestion() } }}
                type="text"
                placeholder="输入你的问题..."
                disabled={chatLoading}
                className="flex-1 h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all"
              />
              <button
                onClick={sendQuestion}
                disabled={!chatInput.trim() || chatLoading}
                className="h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
