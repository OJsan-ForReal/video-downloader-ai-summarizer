import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  siYoutube, siBilibili, siX, siInstagram, siTiktok,
  siFacebook, siVimeo, siTwitch, siReddit, siSoundcloud, siThreads,
} from 'simple-icons'

const PLATFORMS = [
  { name: 'YouTube', icon: siYoutube },
  { name: 'Bilibili', icon: siBilibili },
  { name: 'X / Twitter', icon: siX },
  { name: 'Instagram', icon: siInstagram },
  { name: 'TikTok', icon: siTiktok },
  { name: 'Facebook', icon: siFacebook },
  { name: 'Threads', icon: siThreads },
  { name: 'Vimeo', icon: siVimeo },
  { name: 'Twitch', icon: siTwitch },
  { name: 'Reddit', icon: siReddit },
  { name: 'SoundCloud', icon: siSoundcloud },
]

function PlatformBadge({ name, icon }) {
  return (
    <div className="mx-2 flex flex-shrink-0 items-center gap-2.5 rounded-full border border-slate-200 bg-white px-5 py-2.5 transition-all duration-300 hover:border-slate-300 hover:shadow-sm">
      <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" style={{ fill: `#${icon.hex}` }} aria-hidden="true">
        <path d={icon.path} />
      </svg>
      <span className="whitespace-nowrap text-sm font-medium text-slate-600">{name}</span>
    </div>
  )
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function PlatformWall() {
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()
  // 减弱动态效果时不复制内容（复制是为了配合 -50% 位移做无缝循环滚动，
  // 静止状态下复制反而是重复内容），改成单排自动换行
  const track = reducedMotion ? PLATFORMS : [...PLATFORMS, ...PLATFORMS]

  return (
    <section className="my-16">
      <div className="dashed-divider mx-auto max-w-5xl" />

      <div className="py-10">
        <p className="mb-6 text-center text-xs uppercase tracking-widest text-slate-400">{t('platformWall.label')}</p>

        <div className="platform-marquee-mask relative mx-auto max-w-5xl overflow-hidden">
          <div
            className={reducedMotion ? 'flex flex-wrap justify-center' : 'platform-marquee-track flex w-max items-center'}
          >
            {track.map((p, i) => (
              <PlatformBadge key={`${p.name}-${i}`} name={p.name} icon={p.icon} />
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">{t('platformWall.moreCaption')}</p>
      </div>

      <div className="dashed-divider mx-auto max-w-5xl" />
    </section>
  )
}
