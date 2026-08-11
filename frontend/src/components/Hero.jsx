import { useTranslation } from 'react-i18next'

export default function Hero({ url, setUrl, onParse, loading, error }) {
  const { t } = useTranslation()

  function handleSubmit(e) {
    e.preventDefault()
    onParse()
  }

  return (
    <section className="pt-24 pb-16 px-6 text-center">
      <div className="inline-block mb-6 px-3 py-1 rounded-full border border-teal-200 bg-teal-50 text-teal-600 text-xs tracking-wide">
        {t('hero.badge')}
      </div>
      <h1 className="text-4xl sm:text-6xl font-semibold text-slate-900 tracking-tight mb-4">
        {t('hero.titlePrefix')}<span className="text-teal-600">{t('hero.titleHighlight')}</span>
      </h1>
      <p className="text-slate-500 mb-10 text-sm sm:text-base">
        {t('hero.subtitle')}
      </p>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('hero.placeholder')}
          className="flex-1 bg-white border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 transition-all shadow-sm"
        />
        <button
          type="submit"
          disabled={loading || !url}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-8 py-4 transition-colors shadow-sm"
        >
          {loading ? t('hero.parsing') : t('hero.parse')}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-red-500 text-sm max-w-2xl mx-auto">{error}</p>
      )}
    </section>
  )
}
