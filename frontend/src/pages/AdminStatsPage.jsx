import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Crown, MessageCircle, Sparkles, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getAdminStats } from '../api/stats'

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
    </div>
  )
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 220
const PADDING = { top: 16, right: 16, bottom: 28, left: 36 }

function VisitorTrendChart({ data }) {
  const [hoverIdx, setHoverIdx] = useState(null)

  const innerW = CHART_WIDTH - PADDING.left - PADDING.right
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom
  const rawMax = Math.max(1, ...data.map((d) => d.count))
  // 轴顶不用真实最大值，取整到好看的刻度上、留点呼吸空间，不然折线贴着顶边很局促
  const yMax = Math.ceil((rawMax * 1.2) / 5) * 5 || 5

  const x = (i) => PADDING.left + (i / (data.length - 1)) * innerW
  const y = (v) => PADDING.top + innerH - (v / yMax) * innerH

  const linePoints = data.map((d, i) => `${x(i)},${y(d.count)}`).join(' ')
  const areaPoints = `${x(0)},${y(0)} ${linePoints} ${x(data.length - 1)},${y(0)}`
  const yTicks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax]
  const slotW = innerW / data.length

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">最近 30 天访客趋势</p>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full" onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id="visitorFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0eb5a3" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0eb5a3" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PADDING.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" className="fill-slate-400">
              {Math.round(t)}
            </text>
          </g>
        ))}

        <polygon points={areaPoints} fill="url(#visitorFill)" />
        <polyline points={linePoints} fill="none" stroke="#0eb5a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 最新一天（今天）用实心圆强调收尾 */}
        <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].count)} r="4" fill="#0eb5a3" />

        {hoverIdx !== null && (
          <>
            <line
              x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PADDING.top} y2={CHART_HEIGHT - PADDING.bottom}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3"
            />
            <circle cx={x(hoverIdx)} cy={y(data[hoverIdx].count)} r="4" fill="#0eb5a3" stroke="white" strokeWidth="2" />
          </>
        )}

        {/* 每个数据点一条透明命中带，比数据点本身宽得多，方便悬停 */}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - slotW / 2}
            y={PADDING.top}
            width={slotW}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
          <text key={i} x={x(i)} y={CHART_HEIGHT - 8} textAnchor="middle" fontSize="10" className="fill-slate-400">
            {data[i].date.slice(5)}
          </text>
        ))}
      </svg>

      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${(x(hoverIdx) / CHART_WIDTH) * 100}%`, top: 8, transform: 'translateX(-50%)' }}
        >
          <div className="font-medium">{data[hoverIdx].date}</div>
          <div className="text-teal-300">{data[hoverIdx].count} 位访客</div>
        </div>
      )}
    </div>
  )
}

export default function AdminStatsPage() {
  const { user, loading: authLoading } = useAuth()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.is_superuser) return
    getAdminStats().then(setStats).catch((e) => setError(e.message))
  }, [user])

  if (authLoading) return null
  if (!user?.is_superuser) return <Navigate to="/" replace />
  if (error) return <div className="mx-auto max-w-5xl px-6 py-16 text-center text-red-500">{error}</div>
  if (!stats) return <div className="mx-auto max-w-5xl px-6 py-16 text-center text-slate-400">加载中...</div>

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="mb-6 text-xl font-bold text-slate-900">管理后台</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile icon={Users} label="注册用户" value={stats.total_users} />
        <StatTile icon={Crown} label="Pro 会员" value={stats.pro_users} />
        <StatTile icon={Sparkles} label="AI 总结次数" value={stats.ai_summarize_count} />
        <StatTile icon={MessageCircle} label="AI 问答次数" value={stats.ai_chat_count} />
      </div>

      <VisitorTrendChart data={stats.visitor_trend} />
    </div>
  )
}
