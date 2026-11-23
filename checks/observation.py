import os, sys, json, uuid, base64, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

os.environ["SECRET_KEY"] = Path("/data/secret").read_text().strip()
os.environ["DATABASE_URL"] = "postgresql://postgres@127.0.0.1:5432/vellum"
sys.path.insert(0, "/app/backend")
import httpx
from app.db.session import SessionLocal
from app.models.user import User
from app.api.vault import Document, Event, STORE
from app.services import auth
from app.schemas.auth import SignupRequest, LoginRequest

c = httpx.Client(base_url="http://127.0.0.1:3000/api", timeout=45)
checks = []
uids = []


def check(name, condition):
    assert condition, name
    checks.append(name)
    print("PASS", name, flush=True)


def new():
    r = c.post("/observe/traces")
    r.raise_for_status()
    return r.json()


def headers(t):
    return {"X-Trace-Id": t["id"], "X-Trace-Key": t["key"]}


def read(t):
    events = []
    with c.stream(
        "GET", "/observe/" + t["id"] + "/events", headers={"X-Trace-Key": t["key"]}
    ) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def stages(events):
    out = {}
    for e in events:
        if e["type"] == "step":
            out[e["id"]] = dict(e)
        if e["type"] == "update":
            old = out[e["id"]]
            out[e["id"]] = {**old, **e, "facts": {**old["facts"], **e.get("facts", {})}}
    return {s["name"]: s for s in out.values()}


def traced(method, path, **kwargs):
    t = new()
    r = c.request(
        method, path, headers={**kwargs.pop("headers", {}), **headers(t)}, **kwargs
    )
    e = read(t)
    return r, e, stages(e)


try:
    with SessionLocal() as db:
        suffix = uuid.uuid4().hex[:10]
        email = "observation" + suffix + "@example.com"
        pw = "ObserverSecret1!"
        _, verify = auth.signup(
            SignupRequest(
                email=email, username="obs" + suffix, password=pw, confirm_password=pw
            ),
            db,
        )
        uid = db.query(User).filter_by(email=email).one().id
        uids.append(uid)
    r, e, s = traced("POST", "/auth/verify-email", json={"token": verify})
    check(
        "verification policy is observed",
        r.status_code == 200 and "Verify email ownership" in s,
    )
    t = new()
    first_before_response = False
    with c.stream(
        "GET", "/observe/" + t["id"] + "/events", headers={"X-Trace-Key": t["key"]}
    ) as stream:
        with ThreadPoolExecutor(max_workers=1) as pool:
            f = pool.submit(
                c.post,
                "/auth/login",
                json={"email": email, "password": pw},
                headers=headers(t),
            )
            events = []
            for line in stream.iter_lines():
                if line.startswith("data: "):
                    event = json.loads(line[6:])
                    events.append(event)
                    if event["type"] == "request":
                        first_before_response = not f.done()
            r = f.result()
    check("events arrive before login response completes", first_before_response)
    check("real login succeeds", r.status_code == 200)
    tokens = r.json()
    h = {"Authorization": "Bearer " + tokens["access_token"]}
    s = stages(events)
    check(
        "bcrypt comparison is actually timed",
        s["Compare password securely"]["duration_ms"] > 0,
    )
    check(
        "token signing and session storage are observed",
        "Sign access token" in s and "Commit database transaction" in s,
    )
    check(
        "events have ordered server sequence numbers",
        [e["seq"] for e in events] == list(range(1, len(events) + 1)),
    )
    check(
        "finished event matches actual HTTP result",
        events[-1]["type"] == "finished" and events[-1]["http_status"] == 200,
    )
    serialized = json.dumps(events)
    check(
        "password and access credentials are absent",
        pw not in serialized
        and tokens["access_token"] not in serialized
        and tokens["refresh_token"] not in serialized,
    )
    bad = c.get("/observe/" + t["id"] + "/events", headers={"X-Trace-Key": "wrong"})
    check("wrong trace capability rejected", bad.status_code == 404)
    check(
        "missing trace capability rejected",
        c.get("/observe/" + t["id"] + "/events").status_code == 404,
    )
    check(
        "trace cannot be rebound to another operation",
        c.post(
            "/auth/logout", headers=headers(t), json={"refresh_token": "fake"}
        ).status_code
        == 409,
    )
    r, e, s = traced(
        "POST", "/auth/login", json={"email": email, "password": "IncorrectObserver1!"}
    )
    check(
        "incorrect password comparison appears rejected",
        r.status_code == 401
        and s["Compare password securely"]["status"] == "rejected"
        and e[-1]["status"] == "rejected",
    )
    known_failure_names = set(s)
    r, e, s = traced(
        "POST",
        "/auth/login",
        json={
            "email": "unregisteredobserver@example.com",
            "password": "IncorrectObserver1!",
        },
    )
    check(
        "unknown accounts perform real bcrypt work without revealing membership",
        r.status_code == 401 and set(s) == known_failure_names,
    )
    check(
        "password comparison publishes only a safe boolean",
        s["Compare password securely"]["facts"].get("matched") is False,
    )
    raw = b"Real observational proof\x00" + os.urandom(3000)
    r, e, s = traced(
        "POST", "/vault/documents", headers=h, files={"file": ("proof.bin", raw)}
    )
    check("traced encryption succeeds", r.status_code == 200)
    id = r.json()["id"]
    stored = (STORE / id).read_bytes()
    check(
        "nonce in trace equals stored nonce",
        s["Generate GCM nonce"]["facts"]["nonce_hex"] == stored[:12].hex(),
    )
    check(
        "ciphertext preview equals actual stored ciphertext",
        s["Encrypt document with AES-GCM"]["facts"]["ciphertext_preview"]
        == stored[12:36].hex(),
    )
    check(
        "authentication tag equals actual stored tag",
        s["Encrypt document with AES-GCM"]["facts"]["tag_hex"] == stored[-16:].hex(),
    )
    check(
        "stored byte count equals physical envelope",
        s["Write encrypted envelope"]["facts"]["stored_bytes"] == len(stored),
    )
    with SessionLocal() as db:
        d = db.get(Document, id)
        check(
            "wrapped key preview equals actual wrapped key",
            s["Wrap the document key"]["facts"]["wrapped_preview"]
            == base64.b64decode(d.wrapped_key)[:24].hex(),
        )
        check(
            "signature preview equals actual signature",
            s["Sign document contents"]["facts"]["signature_preview"]
            == base64.b64decode(d.signature)[:24].hex(),
        )
        check(
            "SHA256 equals persisted digest",
            s["Fingerprint document contents"]["facts"]["sha256"] == d.digest,
        )
    check(
        "AES key itself is never included",
        not any(
            k in ("key", "password", "token", "otp", "secret")
            for stage in s.values()
            for k in stage["facts"]
        ),
    )
    r, e, s = traced("GET", f"/vault/documents/{id}/download", headers=h)
    check(
        "decryption trace recovers exact original bytes",
        r.content == raw
        and s["Authenticate and decrypt"]["facts"]["recovered_bytes"] == len(raw),
    )
    check(
        "download runs real signature verification",
        s["Verify RSA-PSS signature"]["facts"]["verified"] is True,
    )
    corrupted = bytearray(stored)
    corrupted[-1] ^= 1
    (STORE / id).write_bytes(corrupted)
    r, e, s = traced("POST", f"/vault/documents/{id}/verify", headers=h)
    check(
        "corrupt ciphertext produces real rejected stage",
        r.status_code == 409 and s["Authenticate and decrypt"]["status"] == "rejected",
    )
    check(
        "signature step is not fabricated after decryption fails",
        "Verify RSA-PSS signature" not in s,
    )
    (STORE / id).write_bytes(stored)
    r, e, s = traced("POST", "/users/2fa/enable", headers=h)
    check(
        "2FA policy database change is observed",
        r.status_code == 200 and "Commit database transaction" in s,
    )
    with SessionLocal() as db:
        pending = auth.login(LoginRequest(email=email, password=pw), db)
    r, e, s = traced(
        "POST",
        "/auth/verify-otp",
        json={"pending_token": pending["pending_token"], "otp": pending["otp"]},
    )
    check(
        "real OTP challenge and digest comparison are observed",
        r.status_code == 200
        and "Verify challenge signature" in s
        and "Compare one-time code" in s,
    )
    check("OTP is absent from event data", pending["otp"] not in json.dumps(e))
    r, e, s = traced(
        "POST", "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    check(
        "refresh rotation is observed",
        r.status_code == 200 and "Rotate session credentials" in s,
    )
    tokens = r.json()
    h = {"Authorization": "Bearer " + tokens["access_token"]}
    r, e, s = traced("GET", "/users/me", headers=h)
    check(
        "profile reads are observable without exposing profile values",
        r.status_code == 200
        and "Return authenticated profile" in s
        and email not in json.dumps(e),
    )
    r, e, s = traced("GET", "/vault/documents", headers=h)
    check(
        "document index counts are measured from actual query results",
        r.status_code == 200
        and s["Read owned document index"]["facts"]["records"] == len(r.json()),
    )
    r, e, s = traced("GET", "/vault/activity", headers=h)
    check(
        "activity read counts are measured from actual query results",
        r.status_code == 200
        and s["Read owned activity records"]["facts"]["records"] == len(r.json()),
    )
    r, e, s = traced("GET", "/vault/audit/verify", headers=h)
    check(
        "activity verification is observed",
        r.status_code == 200 and s["Verify activity chain"]["facts"]["records"] >= 2,
    )
    r, e, s = traced("DELETE", f"/vault/documents/{id}", headers=h)
    check(
        "deletion event matches physical removal",
        r.status_code == 200
        and s["Remove encrypted bytes"]["facts"]["removed"]
        and not (STORE / id).exists(),
    )
    r, e, s = traced(
        "POST", "/auth/forgot-password", json={"email": "missingobserver@example.com"}
    )
    check(
        "recovery keeps account-specific details private",
        r.status_code == 200
        and set(s) == {"Process API request", "Process recovery policy"},
    )
    r, e, s = traced(
        "POST",
        "/auth/resend-verification",
        json={"email": "missingobserver@example.com"},
    )
    check(
        "resend keeps account-specific details private",
        r.status_code == 200
        and set(s) == {"Process API request", "Process recovery policy"},
    )
    with SessionLocal() as db:
        _, reset = auth.forgot_password(email, db)
    r, e, s = traced(
        "POST",
        "/auth/reset-password",
        json={
            "token": reset,
            "password": "ChangedObserver1!",
            "confirm_password": "ChangedObserver1!",
        },
    )
    check(
        "password reset and bcrypt hashing are observed",
        r.status_code == 200
        and "Reset account credentials" in s
        and "Hash password" in s,
    )
    check(
        "new password and reset token are absent",
        "ChangedObserver1!" not in json.dumps(e) and reset not in json.dumps(e),
    )
    r, e, s = traced(
        "POST", "/auth/logout", json={"refresh_token": tokens["refresh_token"]}
    )
    check(
        "logout revocation is observed", r.status_code == 200 and "Revoke session" in s
    )
    print(json.dumps({"passed": len(checks), "checks": checks}, indent=2))
finally:
    with SessionLocal() as db:
        for uid in uids:
            for d in db.query(Document).filter_by(user_id=str(uid)).all():
                (STORE / d.id).unlink(missing_ok=True)
            db.query(Document).filter_by(user_id=str(uid)).delete()
            db.query(Event).filter_by(user_id=str(uid)).delete()
            u = db.get(User, uid)
            if u:
                db.delete(u)
        db.commit()
