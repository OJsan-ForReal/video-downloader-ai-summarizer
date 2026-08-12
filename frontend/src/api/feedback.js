import { authHeaders } from './auth'

// multipart/form-data 提交，不能带 Content-Type: application/json——图片文件不是 JSON 能表达的
export async function submitFeedback({ title, content, image }) {
  const formData = new FormData()
  formData.append('title', title)
  formData.append('content', content)
  if (image) formData.append('image', image)

  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.detail || 'FEEDBACK_SUBMIT_FAILED')
  }
  return response.json()
}

export async function getAdminFeedback() {
  const response = await fetch('/api/feedback', { headers: authHeaders() })
  if (!response.ok) {
    if (response.status === 403) throw new Error('没有管理员权限')
    throw new Error('获取反馈列表失败')
  }
  return response.json()
}

export async function markFeedbackRead(id) {
  const response = await fetch(`/api/feedback/${id}/read`, {
    method: 'PATCH',
    headers: authHeaders(),
  })
  if (!response.ok) throw new Error('操作失败')
  return response.json()
}
