from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError as JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User, UserSession
from datetime import datetime, timezone
from uuid import UUID

_bearer = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise JWTError("Missing subject")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = UUID(user_id)
        sid = UUID(payload.get('sid', ''))
    except (ValueError, TypeError):
        raise HTTPException(401, 'Invalid session.')
    session = db.get(UserSession, sid)
    if not session or session.user_id != user_id or session.is_revoked or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(401, 'Session expired. Please sign in again.')
    user: User | None = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    if user.is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is locked.")
    return user
