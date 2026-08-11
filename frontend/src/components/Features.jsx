import { useTranslation } from 'react-i18next'
import { Globe, MonitorPlay, ShieldCheck, Sparkles } from 'lucide-react'

// 跟 features.items 这个 i18n 数组按顺序一一对应（1800+平台 / AI总结 / 原画质下载 / 无广告无追踪），
// 用下标对应而不是按标题文字匹配，是因为标题在三种语言下文字都不一样，下标才是稳定的
const ICONS = [Globe, Sparkles, MonitorPlay, ShieldCheck]

export default function Features() {
  const { t } = useTranslation()
  const items = t('features.items', { returnObjects: true })

  return (
    <section className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((f, i) => {
        const Icon = ICONS[i] ?? Sparkles
        return (
          <div
            key={f.title}
            className="group bg-white border border-slate-200 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-lg hover:shadow-teal-900/5"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600 transition-colors duration-300 group-hover:bg-teal-600 group-hover:text-white">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <h3 className="text-slate-900 font-semibold mb-1.5">{f.title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
          </div>
        )
      })}
    </section>
  )
}
