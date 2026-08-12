import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertTriangle, Crown, Download, MessageCircle, MessageSquare, Sparkles, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getAdminStats } from '../api/stats'
import { getAdminFeedback, markFeedbackRead } from '../api/feedback'

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

function TrendChart({ title, data, color = '#0eb5a3' }) {
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
  const gradientId = `trendFill-${title.replace(/\s+/g, '')}`

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full" onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
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

        <polygon points={areaPoints} fill={`url(#${gradientId})`} />
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 最新一天（今天）用实心圆强调收尾 */}
        <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].count)} r="4" fill={color} />

        {hoverIdx !== null && (
          <>
            <line
              x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PADDING.top} y2={CHART_HEIGHT - PADDING.bottom}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3"
            />
            <circle cx={x(hoverIdx)} cy={y(data[hoverIdx].count)} r="4" fill={color} stroke="white" strokeWidth="2" />
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
          <div style={{ color }}>{data[hoverIdx].count}</div>
        </div>
      )}
    </div>
  )
}

const REGISTRATION_METHOD_LABELS = { email: '邮箱注册', google: 'Google 注册' }
const REGISTRATION_METHOD_COLORS = { email: '#0eb5a3', google: '#6366f1' }

function RegistrationMethodCard({ breakdown }) {
  const entries = Object.entries(breakdown)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  if (!total) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">注册方式</p>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
        {entries.map(([method, count]) => (
          <div
            key={method}
            style={{ width: `${(count / total) * 100}%`, backgroundColor: REGISTRATION_METHOD_COLORS[method] || '#94a3b8' }}
          />
        ))}
      </div>
      <div className="space-y-1.5">
        {entries.map(([method, count]) => (
          <div key={method} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: REGISTRATION_METHOD_COLORS[method] || '#94a3b8' }} />
              {REGISTRATION_METHOD_LABELS[method] || method}
            </span>
            <span className="font-medium text-slate-900">
              {count} <span className="text-xs font-normal text-slate-400">({Math.round((count / total) * 100)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopUsersTable({ users }) {
  if (!users.length) return null
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">下载量 Top 用户</p>
      <div className="space-y-1.5">
        {users.map((u, i) => (
          <div key={u.email} className="flex items-center justify-between text-sm">
            <span className="text-slate-500">
              <span className="mr-2 inline-block w-4 text-right text-slate-300">{i + 1}</span>
              {u.email}
            </span>
            <span className="font-medium text-slate-900">{u.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SuspiciousIpsTable({ ips }) {
  if (!ips.length) return null
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="mb-3 flex items-center gap-1.5 text-amber-600">
        <AlertTriangle className="h-4 w-4" />
        <p className="text-xs font-medium uppercase tracking-wide">近24小时可疑IP（未拦截，仅提示）</p>
      </div>
      <div className="space-y-1.5">
        {ips.map((row) => (
          <div key={row.ip} className="flex items-center justify-between text-sm">
            <span className="font-mono text-slate-700">{row.ip}</span>
            <span className="text-slate-500">
              {row.count} 次请求 · 最近 {new Date(row.last_seen).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FeedbackTab() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getAdminFeedback().then(setItems).catch((e) => setError(e.message))
  }, [])

  async function toggleRead(id) {
    const updated = await markFeedbackRead(id)
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, is_read: updated.is_read } : f)))
  }

  if (error) return <div className="py-16 text-center text-red-500">{error}</div>
  if (!items) return <div className="py-16 text-center text-slate-400">加载中...</div>
  if (!items.length) return <div className="py-16 text-center text-slate-400">还没有收到反馈</div>

  return (
    <div className="space-y-3">
      {items.map((f) => (
        <div
          key={f.id}
          className={`rounded-2xl border p-5 ${f.is_read ? 'border-slate-200 bg-white' : 'border-teal-200 bg-teal-50/40'}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900">{f.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {f.user_email || '匿名'} · {new Date(f.created_at).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => toggleRead(f.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                f.is_read ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-teal-600 text-white hover:bg-teal-700'
              }`}
            >
              {f.is_read ? '已读' : '标记已读'}
            </button>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{f.content}</p>
          {f.image_path && (
            <img
              src={`/uploads/${f.image_path}`}
              alt=""
              className="mt-3 h-32 rounded-lg border border-slate-200 object-cover"
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default function AdminStatsPage() {
  const { user, loading: authLoading } = useAuth()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (!user?.is_superuser) return
    getAdminStats().then(setStats).catch((e) => setError(e.message))
  }, [user])

  if (authLoading) return null
  if (!user?.is_superuser) return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">管理后台</h1>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-sm">
          <button
            onClick={() => setTab('overview')}
            className={`rounded-full px-4 py-1.5 font-medium transition-colors ${tab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            统计总览
          </button>
          <button
            onClick={() => setTab('feedback')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-colors ${tab === 'feedback' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            用户反馈
          </button>
        </div>
      </div>

      {tab === 'feedback' ? (
        <FeedbackTab />
      ) : error ? (
        <div className="py-16 text-center text-red-500">{error}</div>
      ) : !stats ? (
        <div className="py-16 text-center text-slate-400">加载中...</div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile icon={Users} label="注册用户" value={stats.total_users} />
            <StatTile icon={Crown} label="Pro 会员" value={stats.pro_users} />
            <StatTile icon={Sparkles} label="AI 总结次数" value={stats.ai_summarize_count} />
            <StatTile icon={MessageCircle} label="AI 问答次数" value={stats.ai_chat_count} />
          </div>

          <div className="mb-6 grid grid-cols-3 gap-4">
            <StatTile icon={Download} label="总下载次数" value={stats.total_downloads} />
            <StatTile icon={Download} label="今日下载" value={stats.today_downloads} />
            <StatTile icon={Download} label="本月下载" value={stats.month_downloads} />
          </div>

          {stats.suspicious_ips.length > 0 && (
            <div className="mb-6">
              <SuspiciousIpsTable ips={stats.suspicious_ips} />
            </div>
          )}

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <TrendChart title="最近 30 天访客趋势" data={stats.visitor_trend} color="#0eb5a3" />
            <TrendChart title="最近 30 天下载趋势" data={stats.download_trend} color="#6366f1" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RegistrationMethodCard breakdown={stats.registration_by_method} />
            <TopUsersTable users={stats.top_users} />
          </div>
        </>
      )}
    </div>
  )
}
