import os, sys, asyncio, json
from pathlib import Path

os.environ["SECRET_KEY"] = Path("/data/secret").read_text().strip()
os.environ["DATABASE_URL"] = "postgresql://postgres@127.0.0.1:5432/vellum"
sys.path.insert(0, "/app/backend")
import httpx
from app.core.config import settings
from app.core.email import _wrap
from app.services import auth
from app.db.session import SessionLocal

with SessionLocal() as db:
    verification = auth.resend_verification(settings.MAIL_FROM, db)
# Real provider acceptance, with a useful account security notification.
r = httpx.post(
    "https://api.brevo.com/v3/smtp/email",
    headers={"api-key": settings.BREVO_API_KEY},
    json={
        "sender": {"name": "Vellum", "email": settings.MAIL_FROM},
        "to": [{"email": settings.MAIL_FROM}],
        "subject": "Vellum — email delivery check",
        "htmlContent": _wrap(
            "<h2>Your private workspace is ready.</h2><p>This message confirms that Vellum can send account security emails through the configured provider.</p>"
        ),
    },
    timeout=30,
)
assert r.status_code == 201, (r.status_code, r.text)
print(
    json.dumps(
        {"provider": "Brevo", "accepted": True, "messageId": r.json().get("messageId")},
        indent=2,
    )
)
