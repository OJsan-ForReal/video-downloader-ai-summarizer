/**
 * Stripe 订阅相关 API 封装（沙盒模式，创建结账会话后跳转到 Stripe 托管的付款页）
 */

import { authHeaders } from './auth'

export async function createCheckoutSession() {
  const response = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.detail || 'CHECKOUT_FAILED')
  }
  const data = await response.json()
  return data.checkout_url
}
