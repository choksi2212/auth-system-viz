import base64, hashlib, hmac, json, os, uuid
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import Response
from sqlalchemy import Column, String, Text, DateTime
from sqlalchemy.orm import Session
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.db.base import Base
from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.core.config import settings

router = APIRouter(prefix="/vault", tags=["vault"])
STORE = Path(os.getenv("VAULT_PATH", "/data/vault"))
STORE.mkdir(parents=True, exist_ok=True)
kp = STORE / "identity.pem"
if not kp.exists():
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    kp.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    kp.chmod(0o600)
KEY = serialization.load_pem_private_key(kp.read_bytes(), password=None)


class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True)
    user_id = Column(String, index=True)
    name = Column(String)
    size = Column(String)
    digest = Column(String)
    wrapped_key = Column(Text)
    signature = Column(Text)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Event(Base):
    __tablename__ = "vault_events"
    id = Column(String, primary_key=True)
    user_id = Column(String, index=True)
    action = Column(String)
    name = Column(String)
    previous = Column(String)
    digest = Column(String)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


def event(db, user, action, name):
    db.query(User).filter(User.id == user.id).with_for_update().first()
    prev = (
        db.query(Event)
        .filter_by(user_id=str(user.id))
        .order_by(Event.created_at.desc())
        .first()
    )
    e = Event(
        id=str(uuid.uuid4()),
        user_id=str(user.id),
        action=action,
        name=name,
        previous=prev.digest if prev else "0" * 64,
    )
    e.digest = hmac.new(
        settings.SECRET_KEY.encode(),
        json.dumps(
            [e.previous, e.id, e.user_id, action, name], ensure_ascii=True
        ).encode(),
        hashlib.sha256,
    ).hexdigest()
    db.add(e)


def own(db, user, id):
    d = db.query(Document).filter_by(id=id, user_id=str(user.id)).first()
    if not d:
        raise HTTPException(404, "Document not found.")
    return d


@router.get("/documents")
def documents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [
        {
            "id": d.id,
            "name": d.name,
            "size": d.size,
            "digest": d.digest,
            "created_at": d.created_at,
        }
        for d in db.query(Document)
        .filter_by(user_id=str(user.id))
        .order_by(Document.created_at.desc())
        .all()
    ]


@router.post("/documents")
async def upload(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raw = await file.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, "Files must be 20 MB or smaller.")
    id = str(uuid.uuid4())
    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    cipher = AESGCM(key).encrypt(nonce, raw, (id + str(user.id)).encode())
    wrapped = KEY.public_key().encrypt(
        key,
        padding.OAEP(
            mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None
        ),
    )
    signature = KEY.sign(
        raw,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256(),
    )
    d = Document(
        id=id,
        user_id=str(user.id),
        name=Path(file.filename or "Untitled").name,
        size=str(len(raw)),
        digest=hashlib.sha256(raw).hexdigest(),
        wrapped_key=base64.b64encode(wrapped).decode(),
        signature=base64.b64encode(signature).decode(),
    )
    (STORE / id).write_bytes(nonce + cipher)
    db.add(d)
    event(db, user, "Encrypted", d.name)
    db.commit()
    return {"id": id}


def decrypt(d):
    try:
        key = KEY.decrypt(
            base64.b64decode(d.wrapped_key),
            padding.OAEP(
                mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None
            ),
        )
        data = (STORE / d.id).read_bytes()
        raw = AESGCM(key).decrypt(data[:12], data[12:], (d.id + d.user_id).encode())
        KEY.public_key().verify(
            base64.b64decode(d.signature),
            raw,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256(),
        )
        if hashlib.sha256(raw).hexdigest() != d.digest:
            raise ValueError()
        return raw
    except Exception:
        raise HTTPException(409, "Integrity verification failed. Download blocked.")


@router.get("/documents/{id}/download")
def download(
    id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    d = own(db, user, id)
    raw = decrypt(d)
    event(db, user, "Downloaded", d.name)
    db.commit()
    return Response(raw, media_type="application/octet-stream")


@router.post("/documents/{id}/verify")
def verify(
    id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    d = own(db, user, id)
    decrypt(d)
    event(db, user, "Verified", d.name)
    db.commit()
    return {
        "verified": True,
        "sha256": d.digest,
        "algorithm": "AES-256-GCM · RSA-PSS / SHA-256",
    }


@router.delete("/documents/{id}")
def delete(
    id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    d = own(db, user, id)
    event(db, user, "Deleted", d.name)
    db.delete(d)
    db.commit()
    (STORE / id).unlink(missing_ok=True)
    return {"deleted": True}


@router.get("/activity")
def activity(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Event)
        .filter_by(user_id=str(user.id))
        .order_by(Event.created_at.desc())
        .limit(100)
        .all()
    )


@router.get("/audit/verify")
def verify_audit(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = (
        db.query(Event)
        .filter_by(user_id=str(user.id))
        .order_by(Event.created_at.asc())
        .all()
    )
    previous = "0" * 64
    for e in records:
        expected = hmac.new(
            settings.SECRET_KEY.encode(),
            json.dumps(
                [previous, e.id, e.user_id, e.action, e.name], ensure_ascii=True
            ).encode(),
            hashlib.sha256,
        ).hexdigest()
        if e.previous != previous or not hmac.compare_digest(expected, e.digest):
            raise HTTPException(409, "Activity integrity check failed.")
        previous = e.digest
    return {"verified": True, "records": len(records), "head": previous}
