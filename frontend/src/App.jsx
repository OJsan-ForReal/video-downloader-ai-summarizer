import { useState } from 'react'
import Hero from './components/Hero'
import ResultCard from './components/ResultCard'
import SummaryPanel from './components/SummaryPanel'
import Features from './components/Features'
import PlatformWall from './components/PlatformWall'
import Pricing from './components/Pricing'
import { parseVideo, downloadViaServer } from './api/download'

export default function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const [showSummary, setShowSummary] = useState(false)

  async function handleParse() {
    setLoading(true)
    setError('')
    setResult(null)
    setShowSummary(false)
    try {
      const data = await parseVideo(url)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload(formatId) {
    setDownloading(true)
    setDownloadError('')
    try {
      await downloadViaServer(url, formatId)
    } catch (e) {
      setDownloadError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <span className="text-slate-900 font-bold tracking-tight">▶ 万能下载</span>
        <nav className="text-slate-500 text-sm flex gap-6">
          <a href="#features" className="hover:text-slate-900 transition-colors">功能</a>
          <a href="#pricing" className="hover:text-slate-900 transition-colors">价格</a>
        </nav>
      </header>

      <Hero url={url} setUrl={setUrl} onParse={handleParse} loading={loading} error={error} />

      {result && (
        <ResultCard
          result={result}
          onDownload={handleDownload}
          downloading={downloading}
          downloadError={downloadError}
          onSummarize={() => setShowSummary(true)}
          summarizing={false}
        />
      )}

      {result && showSummary && (
        <section className="max-w-3xl mx-auto px-6 mb-20">
          <SummaryPanel videoUrl={url} videoTitle={result.title} />
        </section>
      )}

      <div id="features">
        <Features />
      </div>
      <PlatformWall />
      <div id="pricing">
        <Pricing />
      </div>

      <footer className="text-center text-slate-400 text-xs py-10">
        仅供技术学习使用，请遵守版权及平台服务条款
      </footer>
    </div>
  )
}
