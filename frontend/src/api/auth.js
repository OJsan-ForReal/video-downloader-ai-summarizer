/**
 * 账号相关 API 封装（邮箱+密码 注册/登录 + Google OAuth 跳转）
 * 用的是 Bearer token 方案：登录成功后把 token 存 localStorage，
 * 之后每次请求自己手动带上 Authorization 头（跟 cookie 方案不同，不用操心 CORS 带凭证的问题）
 */

const TOKEN_KEY = 'auth_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// fastapi-users 报错时 detail 字段不是固定形状：可能是字符串代码、{code,reason} 对象、或 pydantic 校验错误数组。
// 这里只负责把它归一成一个"错误码"字符串，翻译成人话的活交给调用方用 i18n 的 t('errors.' + code) 来做——
// 已知代码（比如 REGISTER_USER_ALREADY_EXISTS）会命中 errors 命名空间里的翻译，命中不了的就原样展示兜底
function extractErrorCode(detail, fallbackCode) {
  if (!detail) return fallbackCode
  if (typeof detail === 'string') return detail
  if (detail.reason) return detail.reason
  if (Array.isArray(detail)) return fallbackCode
  return fallbackCode
}

export async function register(email, password) {
  const response = await fetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(extractErrorCode(data.detail, 'REGISTER_FAILED'))
  }
  return response.json()
}

export async function login(email, password) {
  const body = new URLSearchParams()
  body.set('username', email)
  body.set('password', password)
  const response = await fetch('/auth/jwt/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(extractErrorCode(data.detail, 'LOGIN_FAILED'))
  }
  const data = await response.json()
  setToken(data.access_token)
  return data.access_token
}

export async function getCurrentUser() {
  const token = getToken()
  if (!token) return null
  const response = await fetch('/users/me', { headers: authHeaders() })
  if (!response.ok) {
    clearToken()
    return null
  }
  return response.json()
}

export function logout() {
  clearToken()
}

export async function verifyEmail(token) {
  const response = await fetch('/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(extractErrorCode(data.detail, 'VERIFY_FAILED'))
  }
  return response.json()
}

export async function resendVerification(email) {
  // 这个接口不管邮箱存不存在、验没验证过，一律返回 202，不会告诉你具体原因
  // （防止被用来"探测"哪些邮箱注册过），所以前端这边直接给个统一的提示就行
  await fetch('/auth/request-verify-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export async function getGoogleAuthorizeUrl() {
  const response = await fetch('/auth/google/authorize')
  if (!response.ok) throw new Error('GOOGLE_AUTH_URL_FAILED')
  const data = await response.json()
  return data.authorization_url
}

// Google 登录成功后，后端会把 token 拼在跳回前端的 URL 上（?token=xxx），这里在页面加载时取一次、
// 存进 localStorage，再把 token 从地址栏清掉（不然刷新页面或分享链接会把 token 泄露出去）
export function consumeOAuthRedirect() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  const authError = params.get('auth_error')
  if (!token && !authError) return null

  params.delete('token')
  params.delete('auth_error')
  const cleanQuery = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (cleanQuery ? `?${cleanQuery}` : ''))

  if (token) {
    setToken(token)
    return { ok: true }
  }
  return { ok: false, message: authError || 'GOOGLE_LOGIN_FAILED' }
}
