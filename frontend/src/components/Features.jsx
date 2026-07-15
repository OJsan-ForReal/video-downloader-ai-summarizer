const FEATURES = [
  { title: '1800+ 平台', desc: '基于 yt-dlp，YouTube / Bilibili / X / Instagram 等主流平台全支持' },
  { title: '原画质下载', desc: '自动列出所有可用清晰度，最高支持源画质导出' },
  { title: '直链优先', desc: '优先解析直链，不占用服务器带宽，下载速度更快' },
  { title: '无广告无追踪', desc: '专注下载本身，不收集用户数据，不塞广告' },
]

export default function Features() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {FEATURES.map((f) => (
        <div key={f.title} className="border border-neutral-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-2">{f.title}</h3>
          <p className="text-neutral-500 text-sm leading-relaxed">{f.desc}</p>
        </div>
      ))}
    </section>
  )
}
