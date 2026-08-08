import { useState, useMemo } from 'react'

function formatSize(bytes) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)}MB`
  return `${(mb / 1024).toFixed(2)}GB`
}

const TABS = [
  { key: 'video_audio_formats', label: '视频+音频（推荐）' },
  { key: 'video_only_formats', label: '仅视频' },
  { key: 'audio_only_formats', label: '仅音频' },
]

export default function ResultCard({ result, onDownload, downloading, downloadError, onSummarize, summarizing }) {
  const availableTabs = useMemo(
    () => TABS.filter((t) => (result[t.key] || []).length > 0),
    [result]
  )
  const [activeTab, setActiveTab] = useState(availableTabs[0]?.key)
  const formats = result[activeTab] || []
  const [selectedFormat, setSelectedFormat] = useState(formats[0]?.format_id || '')

  function handleTabChange(key) {
    setActiveTab(key)
    setSelectedFormat((result[key] || [])[0]?.format_id || '')
  }

  return (
    <section className="max-w-3xl mx-auto px-6 mb-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row gap-6 shadow-sm">
        <div className="w-full sm:w-56 aspect-video rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
          <img
            src={result.thumbnail}
            alt={result.title}
            className="max-w-full max-h-full object-contain"
          />
        </div>
        <div className="flex-1 text-left min-w-0">
          <span className="text-xs text-blue-600 font-medium uppercase tracking-wide">{result.platform}</span>
          <h3 className="text-slate-900 font-semibold text-lg mt-1 mb-2 line-clamp-2">{result.title}</h3>
          <p className="text-slate-500 text-sm mb-4">
            {result.uploader} · {result.duration_string}
          </p>

          <div className="flex gap-1 mb-3 border-b border-slate-100">
            {availableTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`px-3 py-2 text-xs border-b-2 -mb-px transition-colors ${
                  activeTab === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {formats.map((f) => (
              <button
                key={f.format_id}
                onClick={() => setSelectedFormat(f.format_id)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  selectedFormat === f.format_id
                    ? 'border-blue-500 bg-blue-50 text-blue-600'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {f.label}
                {f.filesize ? ` · ${formatSize(f.filesize)}` : ''}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onDownload(selectedFormat)}
              disabled={downloading || !selectedFormat}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl px-6 py-2.5 text-sm transition-colors"
            >
              {downloading ? '下载中...' : '下载'}
            </button>
            <button
              onClick={onSummarize}
              disabled={summarizing}
              className="bg-white hover:bg-slate-50 disabled:opacity-40 text-blue-600 font-semibold rounded-xl px-6 py-2.5 text-sm border border-blue-200 transition-colors"
            >
              {summarizing ? 'AI 总结中...' : '✨ AI 总结'}
            </button>
          </div>
          {downloadError && (
            <p className="mt-2 text-red-500 text-xs">{downloadError}</p>
          )}
        </div>
      </div>
    </section>
  )
}
