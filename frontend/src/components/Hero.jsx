export default function Hero({ url, setUrl, onParse, loading, error }) {
  function handleSubmit(e) {
    e.preventDefault()
    onParse()
  }

  return (
    <section className="pt-24 pb-16 px-6 text-center">
      <div className="inline-block mb-6 px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-600 text-xs tracking-wide">
        支持 1800+ 平台 · AI 视频总结 · 无广告
      </div>
      <h1 className="text-4xl sm:text-6xl font-semibold text-slate-900 tracking-tight mb-4">
        粘贴链接，<span className="text-blue-600">秒下载</span>
      </h1>
      <p className="text-slate-500 mb-10 text-sm sm:text-base">
        YouTube / Bilibili / Twitter(X) 等主流平台，一个链接搞定
      </p>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴视频链接..."
          className="flex-1 bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none rounded-xl px-5 py-4 text-slate-900 placeholder-slate-400 transition-all shadow-sm"
        />
        <button
          type="submit"
          disabled={loading || !url}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-8 py-4 transition-colors shadow-sm"
        >
          {loading ? '解析中...' : '解析'}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-red-500 text-sm max-w-2xl mx-auto">{error}</p>
      )}
    </section>
  )
}
