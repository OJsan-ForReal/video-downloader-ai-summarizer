const PLATFORMS = [
  'YouTube', 'Bilibili', 'Twitter / X', 'Instagram', 'TikTok',
  'Facebook', 'Vimeo', 'Twitch', 'Reddit', 'SoundCloud', '+1800 更多',
]

export default function PlatformWall() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-10 text-center">
      <p className="text-neutral-600 text-xs uppercase tracking-widest mb-6">支持的平台</p>
      <div className="flex flex-wrap justify-center gap-3">
        {PLATFORMS.map((p) => (
          <span
            key={p}
            className="px-4 py-2 rounded-full border border-neutral-800 text-neutral-400 text-sm"
          >
            {p}
          </span>
        ))}
      </div>
    </section>
  )
}
