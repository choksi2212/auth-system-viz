import httpx, json, sys
from pathlib import Path

c = httpx.Client(base_url="http://localhost:3080/api", timeout=30)
p = Path("checks/persistence.state.json")
if sys.argv[1] == "before":
    r = c.post(
        "/auth/login",
        json={
            "email": __import__("dotenv").dotenv_values(".env")["DEMO_EMAIL"],
            "password": "VellumDemo1!",
        },
    )
    r.raise_for_status()
    t = r.json()
    raw = Path("sample-files/Private memorandum.txt").read_bytes()
    r = c.post(
        "/vault/documents",
        headers={"Authorization": "Bearer " + t["access_token"]},
        files={"file": ("Private memorandum.txt", raw)},
    )
    r.raise_for_status()
    p.write_text(
        json.dumps({"id": r.json()["id"], "refresh_token": t["refresh_token"]})
    )
    print("PASS persistent document created")
else:
    t = json.loads(p.read_text())
    r = c.post("/auth/refresh", json={"refresh_token": t["refresh_token"]})
    r.raise_for_status()
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    r = c.get("/vault/documents/" + t["id"] + "/download", headers=h)
    r.raise_for_status()
    assert r.content == Path("sample-files/Private memorandum.txt").read_bytes()
    print("PASS database, keys, session and encrypted bytes survive restart")
    r = c.post("/vault/documents/" + t["id"] + "/verify", headers=h)
    r.raise_for_status()
    assert r.json()["verified"]
    print("PASS signature survives restart")
    r = c.delete("/vault/documents/" + t["id"], headers=h)
    r.raise_for_status()
    p.unlink()
