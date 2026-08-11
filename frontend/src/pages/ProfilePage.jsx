import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Avatar from '../components/Avatar'
import { useAuth } from '../context/AuthContext'
import { getQuota } from '../api/summarize'
import { resendVerification } from '../api/auth'
import { useLangPath } from '../i18n/langPath'
import usePageSeo from '../hooks/usePageSeo'

const DATE_LOCALES = { zh: 'zh-CN', en: 'en-US', pt: 'pt-PT' }

export default function ProfilePage() {
  usePageSeo('profile')
  const { user, loading, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const lp = useLangPath()
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [quota, setQuota] = useState(null)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [checkoutNotice, setCheckoutNotice] = useState(null)
  const [verifySent, setVerifySent] = useState(false)

  async function handleResendVerification() {
    await resendVerification(user.email)
    setVerifySent(true)
  }

  useEffect(() => {
    if (!loading && !user) navigate(lp('/'))
  }, [loading, user, navigate, lp])

  useEffect(() => {
    if (user) getQuota().then(setQuota).catch(() => setQuota(null))
  }, [user])

  useEffect(() => {
    const checkout = searchParams.get('checkout')
    if (!checkout) return
    setSearchParams({}, { replace: true })

    if (checkout === 'success') {
      setCheckoutNotice(t('profile.checkoutSuccessPending'))
      // Stripe 的 Webhook 是异步到达的，付款成功那一刻 is_pro 字段可能还没写进数据库，
      // 稍等一下再刷新一次用户信息，避免用户一回来就看到"还是免费版"的错觉
      const timer = setTimeout(() => {
        refreshUser().then((u) => {
          setCheckoutNotice(u?.is_pro ? t('profile.checkoutSuccessConfirmed') : t('profile.checkoutSuccessDelayed'))
          getQuota().then(setQuota).catch(() => {})
        })
      }, 2000)
      return () => clearTimeout(timer)
    }
    if (checkout === 'cancel') {
      setCheckoutNotice(t('profile.checkoutCanceled'))
    }
  }, [searchParams, setSearchParams, refreshUser, t])

  if (loading || !user) return null

  function handleLogout() {
    if (!confirmingLogout) {
      setConfirmingLogout(true)
      return
    }
    logout()
    navigate(lp('/'))
  }

  const usedRatio = quota ? Math.min(1, (quota.limit - quota.remaining) / quota.limit) : 0
  const expiresAtLabel = user.pro_expires_at
    ? new Date(user.pro_expires_at).toLocaleDateString(DATE_LOCALES[i18n.language] || 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <div className="max-w-md mx-auto px-6 pb-16">
      <Link to={lp('/')} className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-700 transition-colors">
        {t('profile.backToHome')}
      </Link>

      {checkoutNotice && (
        <div className="mb-4 rounded-xl bg-teal-50 px-4 py-2.5 text-sm text-teal-700">{checkoutNotice}</div>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <div className="bg-teal-600 px-6 pb-14 pt-8">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-50/70">{t('profile.myAccount')}</p>
        </div>

        <div className="px-6 pb-6">
          <div className="-mt-10 flex items-end gap-4">
            <div className="rounded-full bg-white p-1 shadow-sm">
              <Avatar user={user} size={72} />
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-slate-900">{user.email}</span>
              {user.is_pro && (
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                  PRO
                </span>
              )}
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
              {user.avatar_url ? t('profile.googleLinked') : t('profile.emailPasswordLogin')}
            </div>
          </div>

          {!user.is_verified && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <span>{verifySent ? t('profile.verificationSent') : t('profile.emailNotVerified')}</span>
              {!verifySent && (
                <button
                  onClick={handleResendVerification}
                  className="font-medium underline hover:text-amber-900"
                >
                  {t('profile.resend')}
                </button>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-5">
            <div>
              <div className="text-sm text-slate-500">{t('profile.plan')}</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{user.is_pro ? t('profile.proMember') : t('profile.freeMember')}</div>
              {user.is_pro && expiresAtLabel && (
                <div className="mt-0.5 text-xs text-slate-400">{t('profile.autoRenew', { date: expiresAtLabel })}</div>
              )}
            </div>
            {!user.is_pro && (
              <Link
                to={lp('/pricing')}
                className="rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
              >
                {t('profile.upgradeToPro')}
              </Link>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">{t('profile.dailyQuota')}</span>
              {quota && <span className="text-xs text-slate-400">{t('profile.remainingUses', { count: quota.remaining })}</span>}
            </div>
            {quota ? (
              <>
                <div className="mt-2 text-3xl font-bold text-slate-900">
                  {quota.remaining}
                  <span className="ml-1 text-base font-normal text-slate-400">/ {quota.limit}{t('profile.quotaUnitSuffix')}</span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-all"
                    style={{ width: `${(1 - usedRatio) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="mt-2 text-sm text-slate-400">{t('profile.loading')}</div>
            )}
          </div>

          <button
            onClick={handleLogout}
            onBlur={() => setConfirmingLogout(false)}
            className={`mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              confirmingLogout
                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {confirmingLogout ? t('profile.confirmLogout') : t('profile.logout')}
          </button>
        </div>
      </div>
    </div>
  )
}
