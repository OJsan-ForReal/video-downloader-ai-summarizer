export default function Hero({ url, setUrl, onParse, loading, error }) {
  function handleSubmit(e) {
    e.preventDefault()
    onParse()
  }

  return (
    <section className="pt-24 pb-16 px-6 text-center">
      <div className="inline-block mb-6 px-3 py-1 rounded-full border border-lime-400/30 bg-lime-400/10 text-lime-400 text-xs tracking-wide">
        支持 1800+ 平台 · 无广告 · 无追踪
      </div>
      <h1 className="text-4xl sm:text-6xl font-semibold text-white tracking-tight mb-4">
        粘贴链接，<span className="text-lime-400">秒下载</span>
      </h1>
      <p className="text-neutral-400 mb-10 text-sm sm:text-base">
        YouTube / Bilibili / Twitter(X) 等主流平台，一个链接搞定
      </p>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴视频链接..."
          className="flex-1 bg-neutral-900 border border-neutral-700 focus:border-lime-400 outline-none rounded-xl px-5 py-4 text-white placeholder-neutral-500 transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !url}
          className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-xl px-8 py-4 transition-colors"
        >
          {loading ? '解析中...' : '解析'}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-red-400 text-sm max-w-2xl mx-auto">{error}</p>
      )}
    </section>
  )
}
