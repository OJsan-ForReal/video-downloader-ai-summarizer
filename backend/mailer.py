"""通过 Brevo 的 REST API 发邮件（不是 SMTP，纯 HTTP 请求，更简单）。
BREVO_API_KEY 没配的话，发信函数直接跳过、只打印一行日志，不影响本地开发。
"""

import os

import httpx

BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL", "").strip()
BREVO_SENDER_NAME = os.getenv("BREVO_SENDER_NAME", "Video Downloader").strip()

BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


async def send_email(to_email: str, subject: str, html_content: str) -> None:
    if not BREVO_API_KEY or not BREVO_SENDER_EMAIL:
        print(f"[email] BREVO 还没配置，跳过发信。本来要发给 {to_email}：{subject}")
        return

    async with httpx.AsyncClient() as client:
        response = await client.post(
            BREVO_ENDPOINT,
            headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"},
            json={
                "sender": {"name": BREVO_SENDER_NAME, "email": BREVO_SENDER_EMAIL},
                "to": [{"email": to_email}],
                "subject": subject,
                "htmlContent": html_content,
            },
        )
        response.raise_for_status()


async def send_verification_email(to_email: str, verify_url: str) -> None:
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="color: #0eb5a3;">验证你的邮箱</h2>
      <p style="color: #334155; line-height: 1.6;">
        感谢注册音视频下载器，点击下面的按钮完成邮箱验证：
      </p>
      <a href="{verify_url}"
         style="display: inline-block; margin: 16px 0; padding: 12px 24px;
                background: #0eb5a3; color: #fff; text-decoration: none;
                border-radius: 8px; font-weight: 600;">
        验证邮箱
      </a>
      <p style="color: #94a3b8; font-size: 13px;">
        如果按钮点不了，复制这个链接到浏览器打开：<br>{verify_url}
      </p>
      <p style="color: #94a3b8; font-size: 13px;">如果这不是你本人的操作，忽略这封邮件即可。</p>
    </div>
    """
    await send_email(to_email, "验证你的邮箱 - 音视频下载器", html)
