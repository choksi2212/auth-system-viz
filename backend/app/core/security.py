import secrets
import bcrypt
import hmac
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt import InvalidTokenError as JWTError
from passlib.context import CryptContext
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings
from app.core.observation import observed, detail, protected_fingerprint, current

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Use Redis-backed storage when REDIS_URL is set, otherwise fall back to in-memory.
# In production with multiple workers REDIS_URL must be configured.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.REDIS_URL if settings.REDIS_URL else "memory://",
)


@observed(
    "Hash password",
    "crypto",
    "bcrypt creates a salted, deliberately expensive password verifier. The password and verifier never enter this view.",
    algorithm="bcrypt",
    work_factor=12,
)
def hash_password(password: str) -> str:
    hashed = pwd_context.hash(password)
    detail(
        verifier_fingerprint=protected_fingerprint(hashed.encode()),
        bcrypt_cost=int(hashed.split("$")[2]),
        password_stored=False,
    )
    return hashed


@observed(
    "Compare password securely",
    "identity",
    "bcrypt checks the submitted password against a selected salted verifier, without exposing either value.",
    algorithm="bcrypt",
    result="No password or stored hash is exposed",
)
def verify_password(plain: str, hashed: str) -> bool:
    matched = pwd_context.verify(plain, hashed)
    if current.get():
        candidate = bcrypt.hashpw(plain.encode()[:72], hashed.encode())
        if hmac.compare_digest(candidate, hashed.encode()) != matched:
            raise ValueError("Password comparison cross-check failed")
        detail(
            candidate_fingerprint=protected_fingerprint(candidate),
            stored_fingerprint=protected_fingerprint(hashed.encode()),
            bcrypt_cost=int(hashed.split("$")[2]),
            comparison_verified=True,
        )
    return matched


@observed(
    "Sign access token",
    "crypto",
    "The server signs the session claims with HMAC-SHA256. The token itself stays outside this view.",
    algorithm="HS256",
    expiry_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
)
def create_access_token(subject: str, session_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(
        {"sub": subject, "sid": session_id, "exp": expire, "type": "access"},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


@observed(
    "Generate refresh credential",
    "crypto",
    "The operating system random source generates a new 64-byte refresh secret.",
    random_bytes=64,
)
def create_refresh_token() -> str:
    return secrets.token_urlsafe(64)


@observed(
    "Sign pending challenge",
    "crypto",
    "A short-lived JWT binds the password-verified user to the OTP flow.",
    expiry_seconds=300,
)
def create_2fa_pending_token(user_id: str) -> str:
    """Short-lived JWT used as a session handle between password verification and OTP verification."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "2fa_pending"},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


@observed(
    "Verify token signature",
    "identity",
    "Validate the JWT signature, expiry, and access-token type before trusting any claims.",
    algorithm="HS256",
)
def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(
        token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
    if payload.get("type") != "access":
        raise JWTError("Invalid token type")
    return payload


@observed(
    "Verify challenge signature",
    "identity",
    "Validate the pending JWT signature, expiry, and challenge type.",
    algorithm="HS256",
)
def decode_2fa_pending_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(
        token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )
    if payload.get("type") != "2fa_pending":
        raise JWTError("Invalid token type")
    return payload
