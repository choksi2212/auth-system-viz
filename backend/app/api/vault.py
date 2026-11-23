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
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from app.db.base import Base
from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.core.config import settings
from app.core.observation import step, commit, observed

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
    with step(
        "Link the activity record",
        "crypto",
        "HMAC-SHA256 authenticates the event and the previous record digest.",
    ) as progress:
        e.digest = hmac.new(
            settings.SECRET_KEY.encode(),
            json.dumps(
                [e.previous, e.id, e.user_id, action, name], ensure_ascii=True
            ).encode(),
            hashlib.sha256,
        ).hexdigest()
        progress.update(
            chain_digest=e.digest, previous_chain_digest=e.previous, event_action=action
        )
    db.add(e)


@observed(
    "Check document ownership",
    "identity",
    "Query this document using both its ID and the authenticated owner. Other accounts cannot access it.",
)
def own(db, user, id):
    d = db.query(Document).filter_by(id=id, user_id=str(user.id)).first()
    if not d:
        raise HTTPException(404, "Document not found.")
    return d


@router.get("/documents")
@observed(
    "Read owned document index",
    "storage",
    "Query the documents owned by this authenticated user and return their metadata, without exposing key material.",
)
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
    with step(
        "Read uploaded document",
        "request",
        "Read the actual uploaded bytes and enforce the 20 MB file limit.",
    ) as progress:
        raw = await file.read(20 * 1024 * 1024 + 1)
        progress["input_bytes"] = len(raw)
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, "Files must be 20 MB or smaller.")
    id = str(uuid.uuid4())
    with step(
        "Generate per-file AES key",
        "crypto",
        "Generate a fresh 256-bit secret with the cryptographic random source. Only its fingerprint is observable.",
    ) as progress:
        key = AESGCM.generate_key(bit_length=256)
        progress.update(
            key_bits=len(key) * 8, fingerprint=hashlib.sha256(key).hexdigest()[:16]
        )
    with step(
        "Generate GCM nonce",
        "crypto",
        "Generate 12 random public nonce bytes for this encryption. A nonce is not a password or secret key.",
    ) as progress:
        nonce = os.urandom(12)
        progress.update(nonce_bytes=len(nonce), nonce_hex=nonce.hex())
    # Reconstruct only public counter/output pairs, never secret AES round states.
    # This calculation is checked against the bytes returned by AESGCM below.
    with step(
        "Calculate the first counter blocks",
        "crypto",
        "GCM encrypts nonce-derived counter blocks with AES. Their outputs are XORed with file bytes. This first-block calculation is checked against the actual GCM ciphertext.",
    ) as progress:
        preview_size = min(len(raw), 32)
        counters = b"".join(
            nonce + n.to_bytes(4, "big")
            for n in range(2, 2 + (preview_size + 15) // 16)
        )
        encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
        stream_preview = (encryptor.update(counters) + encryptor.finalize())[
            :preview_size
        ]
        progress.update(
            counter_blocks=[
                counters[i : i + 16].hex() for i in range(0, len(counters), 16)
            ],
            preview_bytes=preview_size,
            aes_rounds=14,
        )
    with step(
        "Encrypt document with AES-GCM",
        "crypto",
        "AES-256-GCM encrypts the bytes and appends an authentication tag. Associated data binds the ciphertext to this document and owner.",
    ) as progress:
        cipher = AESGCM(key).encrypt(nonce, raw, (id + str(user.id)).encode())
        xor_preview = bytes(a ^ b for a, b in zip(raw[:preview_size], stream_preview))
        if not hmac.compare_digest(xor_preview, cipher[:preview_size]):
            raise ValueError("AES-GCM first-block cross-check failed")
        progress.update(
            ciphertext_bytes=len(cipher) - 16,
            tag_hex=cipher[-16:].hex(),
            ciphertext_preview=cipher[:24].hex(),
            ciphertext_window=cipher[:preview_size].hex(),
            xor_verified=True,
            document_id=id,
            aad_bytes=len((id + str(user.id)).encode()),
            owner_bound=True,
        )
    with step(
        "Wrap the document key",
        "crypto",
        "RSA-3072 OAEP encrypts the AES key with the server public key, using SHA-256 and MGF1.",
    ) as progress:
        wrapped = KEY.public_key().encrypt(
            key,
            padding.OAEP(
                mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None
            ),
        )
        progress.update(
            wrapped_bytes=len(wrapped),
            wrapped_preview=wrapped[:24].hex(),
            rsa_bits=KEY.key_size,
        )
    with step(
        "Sign document contents",
        "crypto",
        "RSA-PSS signs a SHA-256 digest of the actual document. The private signing key stays on the server.",
    ) as progress:
        signature = KEY.sign(
            raw,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256(),
        )
        progress.update(
            signature_bytes=len(signature), signature_preview=signature[:24].hex()
        )
    with step(
        "Fingerprint document contents",
        "crypto",
        "SHA-256 computes a content digest from the actual file bytes.",
    ) as progress:
        digest = hashlib.sha256(raw).hexdigest()
        progress["sha256"] = digest
    d = Document(
        id=id,
        user_id=str(user.id),
        name=Path(file.filename or "Untitled").name,
        size=str(len(raw)),
        digest=digest,
        wrapped_key=base64.b64encode(wrapped).decode(),
        signature=base64.b64encode(signature).decode(),
    )
    with step(
        "Write encrypted envelope",
        "storage",
        "Write nonce, ciphertext and authentication tag to persistent storage. Plaintext is not written.",
    ) as progress:
        (STORE / id).write_bytes(nonce + cipher)
        progress["stored_bytes"] = len(nonce) + len(cipher)
    db.add(d)
    event(db, user, "Encrypted", d.name)
    commit(db)
    return {"id": id}


def decrypt(d):
    try:
        with step(
            "Unwrap document key",
            "crypto",
            "The server private key decrypts the RSA-OAEP wrapped AES key. Key bytes remain private.",
        ) as progress:
            key = KEY.decrypt(
                base64.b64decode(d.wrapped_key),
                padding.OAEP(
                    mgf=padding.MGF1(hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None,
                ),
            )
            progress.update(
                key_bits=len(key) * 8,
                fingerprint=hashlib.sha256(key).hexdigest()[:16],
                wrapped_preview=base64.b64decode(d.wrapped_key)[:24].hex(),
                rsa_bits=KEY.key_size,
            )
        with step(
            "Read encrypted envelope",
            "storage",
            "Read the persisted nonce, ciphertext and authentication tag.",
        ) as progress:
            data = (STORE / d.id).read_bytes()
            progress.update(
                stored_bytes=len(data),
                nonce_hex=data[:12].hex(),
                ciphertext_window=data[12:-16][:32].hex(),
                tag_hex=data[-16:].hex(),
                ciphertext_bytes=len(data) - 28,
                counter_blocks=[
                    (data[:12] + i.to_bytes(4, "big")).hex()
                    for i in range(2, 2 + (min(len(data) - 28, 32) + 15) // 16)
                ],
            )
        with step(
            "Authenticate and decrypt",
            "crypto",
            "GCM checks the tag and owner-bound associated data. Modified ciphertext is rejected before releasing plaintext.",
        ) as progress:
            raw = AESGCM(key).decrypt(data[:12], data[12:], (d.id + d.user_id).encode())
            progress["recovered_bytes"] = len(raw)
        with step(
            "Verify RSA-PSS signature",
            "crypto",
            "Verify the actual recovered bytes against the stored signature with the server public key.",
        ) as progress:
            KEY.public_key().verify(
                base64.b64decode(d.signature),
                raw,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=padding.PSS.MAX_LENGTH,
                ),
                hashes.SHA256(),
            )
            progress.update(
                verified=True,
                signature_preview=base64.b64decode(d.signature)[:24].hex(),
                signature_bytes=len(base64.b64decode(d.signature)),
            )
        with step(
            "Compare content fingerprint",
            "crypto",
            "Recompute SHA-256 and compare it with the stored original digest.",
        ) as progress:
            if not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), d.digest):
                raise ValueError()
            progress.update(sha256=d.digest, verified=True)
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
    commit(db)
    return Response(raw, media_type="application/octet-stream")


@router.post("/documents/{id}/verify")
def verify(
    id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    d = own(db, user, id)
    decrypt(d)
    event(db, user, "Verified", d.name)
    commit(db)
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
    commit(db)
    with step(
        "Remove encrypted bytes",
        "storage",
        "Delete the stored encrypted envelope after the database record is removed.",
    ) as progress:
        (STORE / id).unlink(missing_ok=True)
        progress["removed"] = True
    return {"deleted": True}


@router.get("/activity")
@observed(
    "Read owned activity records",
    "storage",
    "Retrieve this account's recent stored document events.",
)
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
    with step(
        "Verify activity chain",
        "crypto",
        "Recompute every HMAC-SHA256 link and compare it with the stored chain.",
        records=len(records),
    ):
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
