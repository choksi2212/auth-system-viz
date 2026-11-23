from app.db.session import SessionLocal
from app.models.user import User
from app.core.security import hash_password
from app.core.config import settings
import os

email = os.getenv("DEMO_EMAIL") or settings.MAIL_FROM or "demo@cryptrace.app"
with SessionLocal() as db:
    if not db.query(User).filter_by(email=email).first():
        db.add(
            User(
                email=email,
                username="alex",
                hashed_password=hash_password("VellumDemo1!"),
                is_verified=True,
            )
        )
        db.commit()
