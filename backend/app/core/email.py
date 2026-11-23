"""
Async email delivery via Brevo (formerly Sendinblue) HTTP API.

Railway blocks all outbound SMTP; Brevo's API uses plain HTTPS so it always
works. The free tier gives 300 emails/day with no domain required — just verify
a sender email address in the Brevo dashboard.

All send_* functions are fire-and-forget safe — exceptions are caught and
logged so a mail failure never crashes a request.

Call them with FastAPI BackgroundTasks:
    background_tasks.add_task(email.send_verification_email, user.email, raw_token)
"""

import logging
from contextlib import nullcontext
from app.core.observation import step, current

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_BREVO_URL = "https://api.brevo.com/v3/smtp/email"


async def _send(subject: str, to: str, html: str) -> None:
    """Send an HTML email via Brevo's transactional email API."""
    if not settings.BREVO_API_KEY or not settings.MAIL_FROM:
        logger.warning(
            "Email not configured (BREVO_API_KEY or MAIL_FROM missing) — "
            "skipped delivery to %s (subject=%r)",
            to,
            subject,
        )
        return
    payload = {
        "sender": {"name": settings.MAIL_FROM_NAME, "email": settings.MAIL_FROM},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    try:
        row = current.get()
        private_recovery = row and row["path"] in (
            "/auth/forgot-password",
            "/auth/resend-verification",
        )
        with (
            nullcontext({})
            if private_recovery
            else step(
                "Submit security email",
                "delivery",
                "Send the real email through Brevo over HTTPS. Provider acceptance does not by itself confirm inbox delivery.",
            )
        ) as progress:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    _BREVO_URL,
                    headers={
                        "api-key": settings.BREVO_API_KEY,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                resp.raise_for_status()
                logger.info(
                    "Email accepted by Brevo: message_id=%s",
                    resp.json().get("messageId"),
                )
            progress["provider_http_status"] = resp.status_code

    except Exception:
        logger.error(
            "Email delivery failed to %s (subject=%r)", to, subject, exc_info=True
        )


# ─── HTML Template Shell ──────────────────────────────────────────────────────


def _wrap(body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f7fb;color:#192b46;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f5f7fb;">
<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 0 26px;font-family:Georgia,serif;font-size:40px;letter-spacing:-2px;color:#192b46;">vellum</td></tr>
<tr><td style="border-top:3px solid #315b8c;border-bottom:1px solid #dbe2ed;padding:36px 30px;background:#edf2f9;">
<p style="font-size:10px;letter-spacing:2px;color:#52647c;margin:0 0 28px;">YOUR PRIVATE WORKSPACE</p>
{body_html}
</td></tr>
<tr><td style="padding:24px 4px;color:#52647c;font-size:12px;line-height:1.8;">
Private by design. Protected by mathematics.<br/>
<span style="font-size:11px;color:#60728a;">If you did not request this action, you can safely ignore this email.</span>
</td></tr></table></td></tr></table></body></html>"""


# ─── Email Senders ────────────────────────────────────────────────────────────


async def send_verification_email(to: str, token: str) -> None:
    link = f"{settings.APP_BASE_URL}/verify-email.html?token={token}"
    body = f"""
<h2 style="margin:0 0 10px;font-family:Georgia,serif;font-size:32px;font-weight:400;color:#192b46;">
  Verify your email address
</h2>
<p style="color:#52647c;line-height:1.65;margin:0 0 28px;">
  Welcome to Vellum! Click the button below to confirm your email address.<br>
  This link is valid for <strong style="color:#192b46;">24 hours</strong>.
</p>
<a href="{link}"
   style="display:inline-block;background:#315b8c;color:#ffffff;text-decoration:none;
          padding:13px 28px;border-radius:4px;font-size:14px;font-weight:500;">
  Verify Email Address
</a>
<p style="color:#60728a;font-size:12px;margin:24px 0 0;line-height:1.6;">
  If the button doesn't work, paste this link into your browser:<br>
  <a href="{link}" style="color:#315b8c;word-break:break-all;">{link}</a>
</p>"""
    await _send("Verify your email — Vellum", to, _wrap(body))


async def send_reset_email(to: str, token: str) -> None:
    link = f"{settings.APP_BASE_URL}/reset-password.html?token={token}"
    body = f"""
<h2 style="margin:0 0 10px;font-family:Georgia,serif;font-size:32px;font-weight:400;color:#192b46;">
  Reset your password
</h2>
<p style="color:#52647c;line-height:1.65;margin:0 0 28px;">
  We received a request to reset the password for your Vellum account.<br>
  This link expires in <strong style="color:#192b46;">1 hour</strong>.
  If you didn't make this request, no action is needed.
</p>
<a href="{link}"
   style="display:inline-block;background:#315b8c;color:#ffffff;text-decoration:none;
          padding:13px 28px;border-radius:4px;font-size:14px;font-weight:500;">
  Reset Password
</a>
<p style="color:#60728a;font-size:12px;margin:24px 0 0;line-height:1.6;">
  Direct link:<br>
  <a href="{link}" style="color:#315b8c;word-break:break-all;">{link}</a>
</p>"""
    await _send("Reset your password — Vellum", to, _wrap(body))


async def send_otp_email(to: str, otp: str) -> None:
    body = f"""
<h2 style="margin:0 0 10px;font-family:Georgia,serif;font-size:32px;font-weight:400;color:#192b46;">
  Your verification code
</h2>
<p style="color:#52647c;line-height:1.65;margin:0 0 24px;">
  Use the code below to complete your sign-in.
  It expires in <strong style="color:#192b46;">5 minutes</strong>.
</p>
<div style="background:#f5f7fb;border:1px solid #dbe2ed;border-radius:4px;
            padding:28px;text-align:center;margin:0 0 24px;">
  <span style="font-size:40px;font-weight:700;letter-spacing:14px;
               color:#192b46;font-family:'Courier New',Courier,monospace;">
    {otp}
  </span>
</div>
<p style="color:#52647c;font-size:13px;margin:0;line-height:1.6;">
  This code is single-use. Never share it with anyone —
  Vellum will <strong>never</strong> ask you for it.
</p>"""
    await _send("Your login OTP — Vellum", to, _wrap(body))
