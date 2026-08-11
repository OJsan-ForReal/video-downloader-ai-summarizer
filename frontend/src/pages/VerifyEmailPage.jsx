import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { verifyEmail } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { useLangPath } from '../i18n/langPath'
import usePageSeo from '../hooks/usePageSeo'

export default function VerifyEmailPage() {
  usePageSeo('verifyEmail')
  const [searchParams] = useSearchParams()
  const { refreshUser } = useAuth()
  const lp = useLangPath()
  const { t } = useTranslation()
  const [status, setStatus] = useState('verifying') // 'verifying' | 'success' | 'error'
  const [message, setMessage] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setMessage(t('verifyEmail.missingToken'))
      return
    }
    verifyEmail(token)
      .then(() => {
        setStatus('success')
        refreshUser().catch(() => {})
      })
      .catch((e) => {
        setStatus('error')
        setMessage(t('errors.' + e.message, e.message))
      })
  }, [searchParams, refreshUser, t])

  return (
    <div className="mx-auto max-w-sm px-6 py-24 text-center">
      {status === 'verifying' && <p className="text-slate-500">{t('verifyEmail.verifying')}</p>}

      {status === 'success' && (
        <>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-50">
            <svg className="h-7 w-7 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">{t('verifyEmail.successTitle')}</h1>
          <Link to={lp('/profile')} className="text-sm font-medium text-teal-600 hover:text-teal-700">
            {t('verifyEmail.goToProfile')}
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">{t('verifyEmail.failTitle')}</h1>
          <p className="mb-4 text-sm text-slate-500">{message}</p>
          <Link to={lp('/profile')} className="text-sm font-medium text-teal-600 hover:text-teal-700">
            {t('verifyEmail.backToProfileRetry')}
          </Link>
        </>
      )}
    </div>
  )
}
