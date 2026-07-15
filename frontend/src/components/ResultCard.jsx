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

export default function ResultCard({ result, onDownload, downloading, downloadError }) {
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
    <section className="max-w-3xl mx-auto px-6 mb-20">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex flex-col sm:flex-row gap-6">
        <img
          src={result.thumbnail}
          alt={result.title}
          className="w-full sm:w-56 aspect-video object-cover rounded-xl bg-neutral-800"
        />
        <div className="flex-1 text-left">
          <span className="text-xs text-lime-400 uppercase tracking-wide">{result.platform}</span>
          <h3 className="text-white font-semibold text-lg mt-1 mb-2 line-clamp-2">{result.title}</h3>
          <p className="text-neutral-500 text-sm mb-4">
            {result.uploader} · {result.duration_string}
          </p>

          <div className="flex gap-1 mb-3 border-b border-neutral-800">
            {availableTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`px-3 py-2 text-xs border-b-2 -mb-px transition-colors ${
                  activeTab === t.key
                    ? 'border-lime-400 text-lime-400'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
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
                    ? 'border-lime-400 bg-lime-400/10 text-lime-400'
                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                }`}
              >
                {f.label}
                {f.filesize ? ` · ${formatSize(f.filesize)}` : ''}
              </button>
            ))}
          </div>

          <button
            onClick={() => onDownload(selectedFormat)}
            disabled={downloading || !selectedFormat}
            className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-black font-semibold rounded-xl px-6 py-2.5 text-sm transition-colors"
          >
            {downloading ? '下载中...' : '下载'}
          </button>
          {downloadError && (
            <p className="mt-2 text-red-400 text-xs">{downloadError}</p>
          )}
        </div>
      </div>
    </section>
  )
}
