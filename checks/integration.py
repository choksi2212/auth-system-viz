import os, sys, json, uuid, hashlib, asyncio
from pathlib import Path

os.environ["SECRET_KEY"] = Path("/data/secret").read_text().strip()
os.environ["DATABASE_URL"] = "postgresql://postgres@127.0.0.1:5432/vellum"
sys.path.insert(0, "/app/backend")
import httpx
from app.db.session import SessionLocal
from app.models.user import User, UserSession, OTPCode, OneTimeToken
from app.schemas.auth import SignupRequest, LoginRequest
from app.services import auth
from app.api.vault import Document, Event, STORE
from app.core.security import create_2fa_pending_token

client = httpx.Client(base_url="http://127.0.0.1:3000/api", timeout=60)
results = []


def check(name, condition):
    assert condition, name
    results.append(name)
    print("PASS", name, flush=True)


def post(p, b, h=None):
    return client.post(p, json=b, headers=h)


users = []
try:
    with SessionLocal() as db:
        for n in range(2):
            suffix = uuid.uuid4().hex[:10]
            email = f"qa{suffix}@example.com"
            pw = "ActualTests1!"
            em, vt = auth.signup(
                SignupRequest(
                    email=email,
                    username="qa" + suffix,
                    password=pw,
                    confirm_password=pw,
                ),
                db,
            )
            check(
                "email verification accepts real token " + str(n),
                post("/auth/verify-email", {"token": vt}).status_code == 200,
            )
            check(
                "verification token cannot replay " + str(n),
                post("/auth/verify-email", {"token": vt}).status_code == 400,
            )
            login = post("/auth/login", {"email": email, "password": pw})
            check("password login " + str(n), login.status_code == 200)
            u = db.query(User).filter_by(email=email).one()
            users.append((u.id, email, pw, login.json()))
    a, b = users
    h = {"Authorization": "Bearer " + a[3]["access_token"]}
    hb = {"Authorization": "Bearer " + b[3]["access_token"]}
    check(
        "anonymous vault rejected",
        client.get("/vault/documents").status_code in (401, 403),
    )
    check(
        "malformed JWT rejected",
        client.get(
            "/users/me", headers={"Authorization": "Bearer bad.token.value"}
        ).status_code
        == 401,
    )
    raw = b"Private bytes\x00" + os.urandom(4096)
    up = client.post(
        "/vault/documents",
        headers=h,
        files={"file": ("../../<script>alert(1)</script>.txt", raw)},
    )
    check("real binary upload", up.status_code == 200)
    id = up.json()["id"]
    check("ciphertext differs from plaintext", raw not in (STORE / id).read_bytes())
    check(
        "encrypted file has GCM envelope length",
        len((STORE / id).read_bytes()) == len(raw) + 28,
    )
    listing = client.get("/vault/documents", headers=h).json()
    check("owner listing contains file", any(d["id"] == id for d in listing))
    check("wrapped key not disclosed", all("wrapped_key" not in d for d in listing))
    check(
        "download byte-for-byte exact",
        client.get(f"/vault/documents/{id}/download", headers=h).content == raw,
    )
    check(
        "signature verification succeeds",
        post(f"/vault/documents/{id}/verify", {}, h).json().get("verified") is True,
    )
    for method, path in [
        ("GET", f"/vault/documents/{id}/download"),
        ("POST", f"/vault/documents/{id}/verify"),
        ("DELETE", f"/vault/documents/{id}"),
    ]:
        check(
            "cross-account " + method + " rejected",
            client.request(method, path, headers=hb).status_code == 404,
        )
    check(
        "oversized upload rejected",
        client.post(
            "/vault/documents",
            headers=h,
            files={"file": ("big.bin", b"x" * (20 * 1024 * 1024 + 1))},
        ).status_code
        == 413,
    )
    original = (STORE / id).read_bytes()
    damaged = bytearray(original)
    damaged[-1] ^= 1
    (STORE / id).write_bytes(damaged)
    check(
        "modified ciphertext blocks download",
        client.get(f"/vault/documents/{id}/download", headers=h).status_code == 409,
    )
    check(
        "modified ciphertext blocks verification",
        post(f"/vault/documents/{id}/verify", {}, h).status_code == 409,
    )
    (STORE / id).write_bytes(original)
    with SessionLocal() as db:
        d = db.get(Document, id)
        sig = d.signature
        d.signature = "AA=="
        db.commit()
    check(
        "forged signature rejected",
        post(f"/vault/documents/{id}/verify", {}, h).status_code == 409,
    )
    with SessionLocal() as db:
        d = db.get(Document, id)
        d.signature = sig
        db.commit()
    with SessionLocal() as db:
        d = db.get(Document, id)
        digest = d.digest
        d.digest = "0" * 64
        db.commit()
    check(
        "changed database digest rejected",
        post(f"/vault/documents/{id}/verify", {}, h).status_code == 409,
    )
    with SessionLocal() as db:
        d = db.get(Document, id)
        d.digest = digest
        wrapped = d.wrapped_key
        d.wrapped_key = "AA=="
        db.commit()
    check(
        "corrupted wrapped key rejected",
        client.get(f"/vault/documents/{id}/download", headers=h).status_code == 409,
    )
    with SessionLocal() as db:
        d = db.get(Document, id)
        d.wrapped_key = wrapped
        db.commit()
    again = client.post(
        "/vault/documents", headers=h, files={"file": ("same.bin", raw)}
    ).json()["id"]
    check(
        "identical plaintext receives different encryption",
        (STORE / id).read_bytes() != (STORE / again).read_bytes(),
    )
    check(
        "delete real document",
        client.delete(f"/vault/documents/{again}", headers=h).status_code == 200,
    )
    check("deleted bytes removed", not (STORE / again).exists())
    check(
        "deleted document not downloadable",
        client.get(f"/vault/documents/{again}/download", headers=h).status_code == 404,
    )
    check(
        "audit chain validates",
        client.get("/vault/audit/verify", headers=h).json().get("verified") is True,
    )
    with SessionLocal() as db:
        e = db.query(Event).filter_by(user_id=str(a[0])).first()
        old = e.action
        e.action = "FORGED"
        db.commit()
        eid = e.id
    check(
        "altered audit event detected",
        client.get("/vault/audit/verify", headers=h).status_code == 409,
    )
    with SessionLocal() as db:
        e = db.get(Event, eid)
        e.action = old
        db.commit()
    check(
        "audit restores after original restored",
        client.get("/vault/audit/verify", headers=h).status_code == 200,
    )
    check("2FA enable", post("/users/2fa/enable", {}, h).status_code == 200)
    with SessionLocal() as db:
        pending = auth.login(LoginRequest(email=a[1], password=a[2]), db)
    check(
        "wrong OTP rejected",
        post(
            "/auth/verify-otp",
            {
                "pending_token": pending["pending_token"],
                "otp": "999999" if pending["otp"] != "999999" else "000000",
            },
        ).status_code
        == 401,
    )
    otp = post(
        "/auth/verify-otp",
        {"pending_token": pending["pending_token"], "otp": pending["otp"]},
    )
    check("real OTP accepted", otp.status_code == 200)
    check(
        "OTP replay rejected",
        post(
            "/auth/verify-otp",
            {"pending_token": pending["pending_token"], "otp": pending["otp"]},
        ).status_code
        == 401,
    )
    check(
        "pending JWT cannot access vault",
        client.get(
            "/vault/documents",
            headers={"Authorization": "Bearer " + pending["pending_token"]},
        ).status_code
        == 401,
    )
    rt = b[3]["refresh_token"]
    rot = post("/auth/refresh", {"refresh_token": rt})
    check(
        "refresh rotation", rot.status_code == 200 and rot.json()["refresh_token"] != rt
    )
    check(
        "old refresh replay rejected",
        post("/auth/refresh", {"refresh_token": rt}).status_code == 401,
    )
    check(
        "old access revoked after rotation",
        client.get("/users/me", headers=hb).status_code == 401,
    )
    rotated = rot.json()
    hh = {"Authorization": "Bearer " + rotated["access_token"]}
    check(
        "rotated access works", client.get("/users/me", headers=hh).status_code == 200
    )
    check(
        "logout works",
        post("/auth/logout", {"refresh_token": rotated["refresh_token"]}).status_code
        == 200,
    )
    check(
        "logged-out access rejected",
        client.get("/users/me", headers=hh).status_code == 401,
    )
    with SessionLocal() as db:
        reset = auth.forgot_password(a[1], db)
    check(
        "password reset",
        post(
            "/auth/reset-password",
            {
                "token": reset[1],
                "password": "ChangedTests1!",
                "confirm_password": "ChangedTests1!",
            },
        ).status_code
        == 200,
    )
    check(
        "reset invalidates existing access",
        client.get("/users/me", headers=h).status_code == 401,
    )
    check(
        "reset replay rejected",
        post(
            "/auth/reset-password",
            {
                "token": reset[1],
                "password": "ChangedTests1!",
                "confirm_password": "ChangedTests1!",
            },
        ).status_code
        == 400,
    )
    check(
        "long bcrypt password rejected",
        post(
            "/auth/signup",
            {
                "email": "long@example.com",
                "username": "longtest",
                "password": "Aa1!" + "a" * 80,
                "confirm_password": "Aa1!" + "a" * 80,
            },
        ).status_code
        == 422,
    )
    check(
        "invalid OTP format rejected",
        post("/auth/verify-otp", {"pending_token": "x", "otp": "123"}).status_code
        == 422,
    )
    check(
        "invalid reset token rejected",
        post(
            "/auth/reset-password",
            {
                "token": "x",
                "password": "ChangedTests1!",
                "confirm_password": "ChangedTests1!",
            },
        ).status_code
        == 400,
    )
    check(
        "SQL injection remains data",
        post("/auth/login", {"email": "' OR 1=1--", "password": "anything"}).status_code
        == 422,
    )
    from concurrent.futures import ThreadPoolExecutor

    with SessionLocal() as db:
        u = db.get(User, b[0])
        access, refresh = auth._create_session(
            u.id, auth.datetime.now(auth.timezone.utc), db
        )

    def rotate(_):
        return post("/auth/refresh", {"refresh_token": refresh}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(rotate, range(2)))
    check(
        "concurrent refresh allows exactly one winner", sorted(statuses) == [200, 401]
    )
    with SessionLocal() as db:
        for _ in range(5):
            try:
                auth.login(LoginRequest(email=b[1], password="Incorrect1!"), db)
            except Exception:
                pass
        locked = db.get(User, b[0])
        db.refresh(locked)
        check(
            "five wrong passwords lock account",
            locked.is_locked and locked.failed_login_attempts == 5,
        )
        try:
            auth.login(LoginRequest(email=b[1], password=b[2]), db)
            blocked = False
        except Exception as exc:
            blocked = getattr(exc, "status_code", None) == 403
        check("locked account rejects correct password", blocked)
    print(json.dumps({"passed": len(results), "checks": results}, indent=2))
finally:
    with SessionLocal() as db:
        for uid, *_ in users:
            for d in db.query(Document).filter_by(user_id=str(uid)).all():
                (STORE / d.id).unlink(missing_ok=True)
            db.query(Document).filter_by(user_id=str(uid)).delete()
            db.query(Event).filter_by(user_id=str(uid)).delete()
            u = db.get(User, uid)
            if u:
                db.delete(u)
        db.commit()
