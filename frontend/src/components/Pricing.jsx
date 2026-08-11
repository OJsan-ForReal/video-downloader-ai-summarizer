import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { createCheckoutSession } from '../api/billing'
import { useLangPath } from '../i18n/langPath'

// 线上部署（`vite build`）默认关闭结账入口：Stripe 还是沙盒模式，公网上任何人拿官方
// 测试卡号都能"免费开通"Pro、白嫖 AI 额度。本地 `vite dev` 不受影响，照常能演示给面试官看
const BILLING_ENABLED = import.meta.env.VITE_ENABLE_BILLING !== 'false'

export default function Pricing() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const lp = useLangPath()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const PLANS = [
    {
      name: 'Free',
      price: '€0',
      features: t('pricing.free.features', { returnObjects: true }),
      highlight: false,
    },
    {
      name: 'Pro',
      price: `€4.99${t('pricing.perMonth')}`,
      features: t('pricing.pro.features', { returnObjects: true }),
      highlight: true,
    },
  ]

  async function handleUpgrade() {
    if (!user) {
      navigate(lp('/login'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const url = await createCheckoutSession()
      window.location.href = url
    } catch (e) {
      setError(t('errors.' + e.message, e.message))
      setLoading(false)
    }
  }

  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <h2 className="text-center text-slate-900 text-2xl font-semibold mb-2">{t('pricing.heading')}</h2>
      <p className="text-center text-slate-500 text-sm mb-10">
        {user?.is_pro
          ? t('pricing.alreadyPro')
          : BILLING_ENABLED
            ? t('pricing.sandboxDemo')
            : t('pricing.notOpenYet')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {PLANS.map((plan) => {
          const isProPlan = plan.name === 'Pro'
          const alreadyPro = isProPlan && user?.is_pro

          return (
            <div
              key={plan.name}
              className={`flex h-full flex-col rounded-2xl p-6 border bg-white ${
                plan.highlight ? 'border-teal-400 shadow-md' : 'border-slate-200 shadow-sm'
              }`}
            >
              <h3 className="text-slate-900 font-semibold text-lg mb-1">{plan.name}</h3>
              <p className="text-2xl text-teal-600 font-bold mb-4">{plan.price}</p>
              <ul className="mb-6 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="text-slate-500 text-sm">· {f}</li>
                ))}
              </ul>
              {isProPlan && (BILLING_ENABLED || alreadyPro) ? (
                <button
                  onClick={handleUpgrade}
                  disabled={loading || alreadyPro}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-teal-600 text-white transition-colors hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {alreadyPro ? t('pricing.subscribed') : loading ? t('pricing.redirecting') : t('pricing.upgrade')}
                </button>
              ) : isProPlan ? (
                <button
                  disabled
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-400 cursor-not-allowed"
                >
                  {t('pricing.notOpen')}
                </button>
              ) : (
                <button
                  disabled
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-400 cursor-not-allowed"
                >
                  {t('pricing.currentPlan')}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {error && <p className="mt-4 text-center text-sm text-red-500">{error}</p>}
    </section>
  )
}
