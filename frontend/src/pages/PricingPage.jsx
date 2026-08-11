import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Pricing from '../components/Pricing'
import { useLangPath } from '../i18n/langPath'
import usePageSeo from '../hooks/usePageSeo'

export default function PricingPage() {
  const { t } = useTranslation()
  usePageSeo('pricing')
  const lp = useLangPath()

  return (
    <div className="max-w-3xl mx-auto px-6 pb-16 pt-2">
      <Link to={lp('/')} className="inline-block text-sm text-slate-400 hover:text-slate-700 transition-colors">
        {t('profile.backToHome')}
      </Link>
      <Pricing />
    </div>
  )
}
