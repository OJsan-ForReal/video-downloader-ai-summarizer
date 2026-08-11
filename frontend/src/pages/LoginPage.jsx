import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Coffee } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getGoogleAuthorizeUrl } from '../api/auth'
import PasswordInput from '../components/PasswordInput'
import { useLangPath } from '../i18n/langPath'
import usePageSeo from '../hooks/usePageSeo'

export default function LoginPage({ mode: initialMode = 'login' }) {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const lp = useLangPath()
  const { t } = useTranslation()

  const [mode, setMode] = useState(initialMode)
  usePageSeo(mode === 'register' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const SELLING_POINTS = t('auth.sellingPoints', { returnObjects: true })

  function switchMode(next) {
    setMode(next)
    setError('')
    setPassword('')
    setConfirmPassword('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'register' && password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password)
      navigate(lp('/'))
    } catch (err) {
      setError(t('errors.' + err.message, err.message))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    try {
      const url = await getGoogleAuthorizeUrl()
      window.location.href = url
    } catch (err) {
      setError(t('errors.' + err.message, err.message))
      setGoogleLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
    <div className="flex flex-1 min-h-[calc(100vh-88px)]">
      <div className="hidden lg:flex lg:w-[42%] flex-col bg-teal-600 px-12 py-14 text-white transition-colors duration-500 hover:bg-teal-700">
        <Link to={lp('/')} className="text-lg font-bold tracking-tight">{t('nav.brand')}</Link>

        <div className="flex flex-1 items-center">
          <div>
            <p className="text-3xl font-bold leading-tight text-balance mb-10">
              {t('auth.headline')}
            </p>
            <ul className="space-y-6">
              {SELLING_POINTS.map((p) => (
                <li
                  key={p.title}
                  className="group flex gap-3 -mx-3 rounded-xl px-3 py-2 transition-all duration-300 hover:bg-white/10 hover:translate-x-1"
                >
                  <svg
                    className="h-5 w-5 flex-shrink-0 mt-0.5 transition-transform duration-300 group-hover:scale-110"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="font-semibold">{p.title}</p>
                    <p className="text-sm text-teal-50/80">{p.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-6 py-14">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <Link to={lp('/')} className="mb-8 inline-block text-sm text-slate-400 hover:text-slate-700 transition-colors lg:hidden">
              {t('auth.backToHome')}
            </Link>

            <div key={mode} className="auth-transition">
              <h1 className="mb-6 text-2xl font-bold text-slate-900">
                {mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
              </h1>

              <button
                onClick={handleGoogle}
                disabled={googleLoading}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.48a5.55 5.55 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.88-3.01c-1.07.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.93H1.3v3.1A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.31 14.31A7.2 7.2 0 0 1 4.93 12c0-.8.14-1.58.38-2.31v-3.1H1.3A12 12 0 0 0 0 12c0 1.93.46 3.76 1.3 5.41l4.01-3.1Z" />
                  <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.3 6.59l4.01 3.1C6.25 6.85 8.89 4.75 12 4.75Z" />
                </svg>
                {googleLoading ? t('auth.redirecting') : t('auth.googleLogin')}
              </button>

              <div className="mb-4 flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                {t('auth.orEmail')}
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">{t('auth.emailLabel')}</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500"
                  />
                </div>
                <PasswordInput
                  label={t('auth.passwordLabel')}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText={mode === 'register' ? t('auth.passwordHelper') : null}
                />
                {mode === 'register' && (
                  <PasswordInput
                    label={t('auth.confirmPasswordLabel')}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                )}

                {error && <p className="text-sm text-red-500">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                >
                  {loading ? t('auth.submitting') : mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}
                </button>
              </form>

              <p className="mt-4 text-center text-xs text-slate-500">
                {mode === 'login' ? t('auth.noAccount') : t('auth.hasAccount')}
                <button
                  onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                  className="ml-1 font-medium text-teal-600 hover:text-teal-700"
                >
                  {mode === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer className="border-t border-teal-100 bg-teal-50/60 py-6 text-center text-xs text-slate-500 space-y-2">
      <p>{t('nav.disclaimer')}</p>
      {/* TODO: 占位链接，等注册 Buy Me a Coffee 账号后替换成真实链接 */}
      <a
        href="https://www.buymeacoffee.com/TODO_替换成真实用户名"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-white px-3 py-1 text-slate-500 transition-colors hover:border-teal-600 hover:text-teal-600"
      >
        <Coffee size={13} />
        {t('nav.buyMeCoffee')}
      </a>
      <p>{t('nav.copyright')}</p>
    </footer>
    </div>
  )
}
