const PLANS = [
  {
    name: 'Free',
    price: '¥0',
    features: ['基础清晰度下载', '每日 10 次解析', '直链下载模式'],
    highlight: false,
  },
  {
    name: 'Pro',
    price: '¥19/月',
    features: ['4K 原画质下载', '不限次数解析', '批量下载', '优先下载队列'],
    highlight: true,
  },
]

export default function Pricing() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <h2 className="text-center text-white text-2xl font-semibold mb-2">升级 Pro，解锁全部能力</h2>
      <p className="text-center text-neutral-500 text-sm mb-10">即将上线，敬请期待</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-2xl p-6 border ${
              plan.highlight
                ? 'border-lime-400 bg-lime-400/5'
                : 'border-neutral-800'
            }`}
          >
            <h3 className="text-white font-semibold text-lg mb-1">{plan.name}</h3>
            <p className="text-2xl text-lime-400 font-bold mb-4">{plan.price}</p>
            <ul className="space-y-2 mb-6">
              {plan.features.map((f) => (
                <li key={f} className="text-neutral-400 text-sm">· {f}</li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-neutral-800 text-neutral-500 cursor-not-allowed"
            >
              即将上线
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
