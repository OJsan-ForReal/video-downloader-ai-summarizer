import { useEffect, useState } from 'react'
import { Coffee, Menu, X } from 'lucide-react'
import { Link, Route, Routes, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Avatar from './components/Avatar'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import PricingPage from './pages/PricingPage'
import ProfilePage from './pages/ProfilePage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import AdminStatsPage from './pages/AdminStatsPage'
import FeedbackPage from './pages/FeedbackPage'
import ParallaxIllustration from './components/ParallaxIllustration'
import FeedbackButton from './components/FeedbackButton'
import { useAuth } from './context/AuthContext'
import { ALL_LANGS, useCurrentLang, useLangPath, stripLangPrefix, withLang } from './i18n/langPath'
import { trackVisit, getPublicStats } from './api/stats'
import footerBg from './assets/kkkk.jpg'

const LANG_LABELS = { zh: '中文', en: 'EN', pt: 'PT' }

function AuthHeaderControls() {
  const { user, loading, oauthError } = useAuth()
  const { t } = useTranslation()
  const lp = useLangPath()

  if (loading) return <div className="h-8 w-16" />

  return (
    <div className="relative min-w-0">
      {user ? (
        <Link to={lp('/profile')} className="flex min-w-0 items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors">
          <Avatar user={user} />
          <span className="truncate max-w-[140px] sm:max-w-[180px]">{user.email}</span>
        </Link>
      ) : (
        <Link
          to={lp('/login')}
          className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        >
          {t('nav.login')}
        </Link>
      )}
      {oauthError && (
        <span className="absolute top-full right-0 mt-1 whitespace-nowrap text-xs text-red-500">
          {t('errors.' + oauthError, oauthError)}
        </span>
      )}
    </div>
  )
}

function LanguageSwitcher() {
  const currentLang = useCurrentLang() || 'zh'
  const location = useLocation()
  const navigate = useNavigate()

  function switchTo(target) {
    if (target === currentLang) return
    const rest = stripLangPrefix(location.pathname, currentLang)
    navigate(withLang(target, rest) + location.search)
  }

  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      {ALL_LANGS.map((code) => (
        <button
          key={code}
          onClick={() => switchTo(code)}
          className={currentLang === code ? 'text-teal-600' : 'text-slate-400 hover:text-slate-600 transition-colors'}
        >
          {LANG_LABELS[code]}
        </button>
      ))}
    </div>
  )
}

function VisitorCount() {
  const { t } = useTranslation()
  const [count, setCount] = useState(null)
  useEffect(() => { getPublicStats().then((d) => setCount(d.month_visitors)).catch(() => {}) }, [])
  if (count === null) return null
  return <p>{t('nav.monthlyVisitors', { count })}</p>
}

function MainLayout() {
  const { t } = useTranslation()
  const lp = useLangPath()
  const { user } = useAuth()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    // 每个浏览器会话只上报一次访问，不是每次切页面都上报（后端按天+IP去重，
    // 这里加一层前端节流单纯是省几次没必要的网络请求）
    if (sessionStorage.getItem('visit_tracked')) return
    sessionStorage.setItem('visit_tracked', '1')
    trackVisit()
  }, [])

  // 切换页面/切换语言后自动收起移动端菜单，避免切完语言菜单还悬在那儿挡内容
  useEffect(() => { setMobileMenuOpen(false) }, [location.pathname])

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-transparent bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_14px_rgba(15,23,42,0.04)] transition-all duration-300 hover:border-slate-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_10px_28px_rgba(15,23,42,0.1)]">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="flex items-center justify-between gap-3">
            <Link to={lp('/')} className="flex-shrink-0 truncate text-slate-900 font-bold tracking-tight">
              {t('nav.brand')}
            </Link>

            {/* 桌面端：横排展示；窄屏（PT语言文案更长，最容易在这个断点撑爆）收进汉堡菜单 */}
            <div className="hidden min-w-0 items-center gap-6 sm:flex">
              {user?.is_superuser && (
                <Link to={lp('/admin')} className="whitespace-nowrap text-sm text-slate-500 hover:text-slate-900 transition-colors">
                  {t('nav.adminPanel')}
                </Link>
              )}
              <LanguageSwitcher />
              <AuthHeaderControls />
            </div>

            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={t('nav.brand')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 sm:hidden"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="mt-4 flex flex-col items-start gap-4 border-t border-slate-100 pt-4 sm:hidden">
              {user?.is_superuser && (
                <Link to={lp('/admin')} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
                  {t('nav.adminPanel')}
                </Link>
              )}
              <LanguageSwitcher />
              <AuthHeaderControls />
            </div>
          )}
        </div>
      </header>

      <Outlet />
      <FeedbackButton />

      <footer className="relative mt-8 border-t border-teal-100 bg-teal-50/60 py-10 text-center text-xs text-slate-700 space-y-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-full max-w-5xl -translate-x-1/2 bg-cover bg-center opacity-70"
          style={{ backgroundImage: `url(${footerBg})` }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-teal-50/30" />

        {/* 屏幕窄于 lg（1024px）断点时隐藏。absolute 相对页脚定位（不是 fixed 相对视口），
            只会出现在页脚这个区域里，不会跟着滚动跑到别的地方；z-20 保证盖住背景图/遮罩层，
            但内部鼠标跟随的视差效果是组件自己处理的，跟外层用 absolute 还是 fixed 无关 */}
        <ParallaxIllustration className="pointer-events-none absolute bottom-0 left-0 z-20 hidden h-44 w-44 opacity-[0.18] lg:block" />
        <ParallaxIllustration className="pointer-events-none absolute bottom-0 right-0 z-20 hidden h-44 w-44 -scale-x-100 opacity-[0.18] lg:block" />

        <div className="relative z-10 space-y-3" style={{ textShadow: '0 1px 3px rgba(255,255,255,0.8)' }}>
          <p>{t('nav.disclaimer')}</p>
          <a
            href="https://buymeacoffee.com/onlyforchag"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-white px-3 py-1 text-slate-700 hover:border-teal-600 hover:text-teal-600 transition-colors"
          >
            <Coffee size={14} />
            {t('nav.buyMeCoffee')}
          </a>
          <VisitorCount />
          <p>{t('nav.copyright')}</p>
          <p className="text-[11px] text-slate-600">
            Illustration by{' '}
            <a href="https://storyset.com/nature" target="_blank" rel="noopener noreferrer" className="underline hover:text-teal-600">
              Storyset
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

function LangRoot() {
  const { i18n } = useTranslation()
  const lang = useCurrentLang()

  useEffect(() => {
    if (!lang) return
    i18n.changeLanguage(lang)
    document.documentElement.lang = lang
    // 网页标题/描述交给各个页面组件自己的 usePageSeo 管（每个页面标题不一样，
    // 这里只负责 <html lang> 这种全站统一的东西，不要在这里再设一遍 document.title
    // 跟具体页面抢——子组件的 effect 先跑，这里如果也设，反而会把具体页面的标题覆盖掉）
  }, [lang, i18n])

  // 不认识的语言前缀（比如 /fr/xxx）：不做特殊处理，走现有的“找不到页面”逻辑（渲染空白）
  if (lang === null) return null

  return <Outlet />
}

// 所有页面路由只定义一次，分别挂载在无前缀（默认中文）和 /:lang 两棵路由树下
const routeChildren = (
  <>
    <Route path="login" element={<LoginPage mode="login" />} />
    <Route path="register" element={<LoginPage mode="register" />} />
    <Route element={<MainLayout />}>
      <Route index element={<HomePage />} />
      <Route path="pricing" element={<PricingPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="admin" element={<AdminStatsPage />} />
      <Route path="feedback" element={<FeedbackPage />} />
    </Route>
  </>
)

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LangRoot />}>{routeChildren}</Route>
      <Route path="/:lang" element={<LangRoot />}>{routeChildren}</Route>
    </Routes>
  )
}
