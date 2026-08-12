import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, X } from 'lucide-react'
import { submitFeedback } from '../api/feedback'
import usePageSeo from '../hooks/usePageSeo'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export default function FeedbackPage() {
  const { t } = useTranslation()
  usePageSeo('feedback')

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [image, setImage] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const fileInputRef = useRef(null)

  function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('feedback.imageTooLarge'))
      return
    }
    setError('')
    setImage(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function removeImage() {
    setImage(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await submitFeedback({ title, content, image })
      setDone(true)
    } catch (err) {
      // 后端校验/限流报错的 detail 本身就是可读的中文文案，跟 LoginPage 同款处理：
      // 已知错误码命中翻译；命中不了就直接把后端原文当兜底展示
      setError(t('errors.' + err.message, err.message))
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="mb-2 text-xl font-bold text-slate-900">{t('feedback.thanksTitle')}</h1>
        <p className="text-sm text-slate-500">{t('feedback.thanksBody')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-2 text-xl font-bold text-slate-900">{t('feedback.pageTitle')}</h1>
      <p className="mb-8 text-sm text-slate-500">{t('feedback.pageSubtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('feedback.titleLabel')}</label>
          <input
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('feedback.titlePlaceholder')}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('feedback.contentLabel')}</label>
          <textarea
            required
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('feedback.contentPlaceholder')}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('feedback.imageLabel')}</label>
          {imagePreview ? (
            <div className="relative inline-block">
              <img src={imagePreview} alt="" className="h-28 w-28 rounded-lg object-cover border border-slate-200" />
              <button
                type="button"
                onClick={removeImage}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-slate-400 transition-colors hover:border-teal-400 hover:text-teal-600"
            >
              <ImagePlus size={20} />
              <span className="text-xs">{t('feedback.uploadImage')}</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageChange}
            className="hidden"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
        >
          {loading ? t('feedback.submitting') : t('feedback.submit')}
        </button>
      </form>
    </div>
  )
}
