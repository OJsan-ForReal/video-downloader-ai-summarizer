import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function formatSize(bytes) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)}MB`
  return `${(mb / 1024).toFixed(2)}GB`
}

export default function ResultCard({ result, onDownload, downloading, downloadError, onSummarize, summarizing }) {
  const { t } = useTranslation()
  const TABS = [
    { key: 'video_audio_formats', label: t('result.tabVideoAudio') },
    { key: 'video_only_formats', label: t('result.tabVideoOnly') },
    { key: 'audio_only_formats', label: t('result.tabAudioOnly') },
  ]
  const availableTabs = TABS.filter((tab) => (result[tab.key] || []).length > 0)
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
          <span className="text-xs text-teal-600 font-medium uppercase tracking-wide">{result.platform}</span>
          <h3 className="text-slate-900 font-semibold text-lg mt-1 mb-2 line-clamp-2">{result.title}</h3>
          <p className="text-slate-500 text-sm mb-4">
            {result.uploader} · {result.duration_string}
          </p>

          <div className="flex gap-1 mb-3 border-b border-slate-100">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`px-3 py-2 text-xs border-b-2 -mb-px transition-colors ${
                  activeTab === tab.key
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {tab.label}
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
                    ? 'border-teal-500 bg-teal-50 text-teal-600'
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
              className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold rounded-xl px-6 py-2.5 text-sm transition-colors"
            >
              {downloading ? t('result.downloading') : t('result.download')}
            </button>
            <button
              onClick={onSummarize}
              disabled={summarizing}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-teal-600 font-semibold rounded-xl px-6 py-2.5 text-sm border border-teal-200 transition-colors"
            >
              {!summarizing && <Sparkles className="h-4 w-4" />}
              {summarizing ? t('result.summarizing') : t('result.aiSummarize')}
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
