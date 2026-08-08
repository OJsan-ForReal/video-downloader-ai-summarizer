const PLATFORMS = [
  'YouTube', 'Bilibili', 'Twitter / X', 'Instagram', 'TikTok',
  'Facebook', 'Vimeo', 'Twitch', 'Reddit', 'SoundCloud', '+1800 更多',
]

export default function PlatformWall() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-10 text-center">
      <p className="text-slate-400 text-xs uppercase tracking-widest mb-6">支持的平台</p>
      <div className="flex flex-wrap justify-center gap-3">
        {PLATFORMS.map((p) => (
          <span
            key={p}
            className="px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-500 text-sm"
          >
            {p}
          </span>
        ))}
      </div>
    </section>
  )
}
