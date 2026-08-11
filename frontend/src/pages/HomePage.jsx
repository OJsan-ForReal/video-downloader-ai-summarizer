import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Hero from '../components/Hero'
import ResultCard from '../components/ResultCard'
import SummaryPanel from '../components/SummaryPanel'
import Features from '../components/Features'
import PlatformWall from '../components/PlatformWall'
import { parseVideo, downloadViaServer } from '../api/download'
import usePageSeo from '../hooks/usePageSeo'

export default function HomePage() {
  const { t } = useTranslation()
  usePageSeo('home')
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
      setError(t('errors.' + e.message, e.message))
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
      setDownloadError(t('errors.' + e.message, e.message))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
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
    </>
  )
}
