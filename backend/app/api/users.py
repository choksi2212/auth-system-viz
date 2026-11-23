from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.core.observation import commit, observed
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import MessageResponse
from app.schemas.user import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
@observed(
    "Return authenticated profile",
    "identity",
    "Return the permitted public profile fields for the user resolved by the active-session checks.",
)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/2fa/enable", response_model=MessageResponse)
@observed(
    "Enable email second factor",
    "identity",
    "Update the authenticated account policy so future logins require an emailed OTP.",
)
def enable_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.is_2fa_enabled = True
    commit(db)
    return {
        "message": "Two-factor authentication enabled. Your next login will require an OTP."
    }


@router.post("/2fa/disable", response_model=MessageResponse)
@observed(
    "Disable email second factor",
    "identity",
    "Update the authenticated account policy to use password authentication without an OTP challenge.",
)
def disable_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.is_2fa_enabled = False
    commit(db)
    return {"message": "Two-factor authentication disabled."}
