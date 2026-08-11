import { authHeaders } from './auth'

export async function trackVisit() {
  // 静默的埋点请求，失败了也不用管（不影响用户使用网站），不抛错、不重试
  try {
    await fetch('/api/stats/track-visit', { method: 'POST' })
  } catch { /* ignore */ }
}

export async function getPublicStats() {
  const response = await fetch('/api/stats/public')
  if (!response.ok) throw new Error('获取访问统计失败')
  return response.json()
}

export async function getAdminStats() {
  const response = await fetch('/api/stats/admin', { headers: authHeaders() })
  if (!response.ok) {
    if (response.status === 403) throw new Error('没有管理员权限')
    throw new Error('获取管理数据失败')
  }
  return response.json()
}
