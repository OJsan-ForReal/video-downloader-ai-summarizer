// Google 登录的用户有真实头像（user.avatar_url），邮箱密码注册的用户没有，
// 没有的时候用邮箱首字母 + 固定配色圆圈顶上，纯本地计算，不依赖任何外部头像服务
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

function colorForEmail(email) {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash)
  return COLORS[Math.abs(hash) % COLORS.length]
}

export default function Avatar({ user, size = 28 }) {
  const style = { width: size, height: size }

  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.email}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover"
        style={style}
      />
    )
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ ...style, backgroundColor: colorForEmail(user.email), fontSize: size * 0.45 }}
    >
      {user.email[0].toUpperCase()}
    </div>
  )
}
