import { Link, useLocation } from 'react-router-dom'
import { MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLangPath, stripLangPrefix } from '../i18n/langPath'

// 全站悬浮入口，唯独反馈页自己不显示（避免"点按钮跳到反馈页，反馈页上又叠一个同样的按钮"）
export default function FeedbackButton() {
  const { t } = useTranslation()
  const lp = useLangPath()
  const location = useLocation()

  if (stripLangPrefix(location.pathname) === '/feedback') return null

  return (
    <Link
      to={lp('/feedback')}
      title={t('feedback.entry')}
      aria-label={t('feedback.entry')}
      className="fixed right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg transition-all hover:bg-teal-700 hover:scale-105 sm:right-6"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <MessageSquarePlus size={22} />
    </Link>
  )
}
