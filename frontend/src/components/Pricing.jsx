const PLANS = [
  {
    name: 'Free',
    price: '¥0',
    features: ['视频/音频下载不限次数', 'AI 总结每日 3 次', '基础清晰度'],
    highlight: false,
  },
  {
    name: 'Pro',
    price: '¥19/月',
    features: ['视频/音频下载不限次数', 'AI 总结每日 10 次', '4K 原画质下载', '优先下载队列'],
    highlight: true,
  },
]

export default function Pricing() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <h2 className="text-center text-slate-900 text-2xl font-semibold mb-2">升级 Pro，解锁更多 AI 总结次数</h2>
      <p className="text-center text-slate-500 text-sm mb-10">即将上线，敬请期待</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-2xl p-6 border bg-white ${
              plan.highlight ? 'border-blue-400 shadow-md' : 'border-slate-200 shadow-sm'
            }`}
          >
            <h3 className="text-slate-900 font-semibold text-lg mb-1">{plan.name}</h3>
            <p className="text-2xl text-blue-600 font-bold mb-4">{plan.price}</p>
            <ul className="space-y-2 mb-6">
              {plan.features.map((f) => (
                <li key={f} className="text-slate-500 text-sm">· {f}</li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-400 cursor-not-allowed"
            >
              即将上线
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
