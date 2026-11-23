"""Request-local, capability-protected telemetry. Never records arguments or secrets."""

import asyncio
import contextvars
import functools
import hmac
import json
import secrets
import threading
import time
import uuid
from contextlib import contextmanager
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

current = contextvars.ContextVar("vellum_trace", default=None)
parent = contextvars.ContextVar("vellum_trace_parent", default=None)
quiet = contextvars.ContextVar("vellum_trace_quiet", default=False)
rows = {}
lock = threading.RLock()
TTL = 300
router = APIRouter(prefix="/observe", tags=["live operations"])


@router.post("/traces")
@limiter.limit("120/minute")
def create(request: Request):
    now = time.monotonic()
    with lock:
        for id in list(rows):
            if now - rows[id]["created"] > TTL:
                del rows[id]
        if len(rows) >= 1024:
            raise HTTPException(429, "Live view is busy. Try again shortly.")
        id = uuid.uuid4().hex
        key = secrets.token_urlsafe(32)
        rows[id] = {
            "key": key,
            "created": now,
            "events": [],
            "done": False,
            "bound": False,
            "path": "",
        }
    return {"id": id, "key": key, "expires_in": TTL}


def authorize(id, key):
    row = rows.get(id)
    if (
        not row
        or time.monotonic() - row["created"] > TTL
        or not hmac.compare_digest(row["key"].encode(), key.encode())
    ):
        raise HTTPException(404, "Live operation not found.")
    return row


@router.get("/{id}/events")
async def events(id: str, request: Request):
    with lock:
        row = authorize(id, request.headers.get("x-trace-key", ""))

    async def stream():
        offset = 0
        yield ": connected\n\n"
        while time.monotonic() - row["created"] < TTL:
            if await request.is_disconnected():
                return
            with lock:
                batch = list(row["events"][offset:])
                done = row["done"]
            for item in batch:
                yield "data: " + json.dumps(item) + "\n\n"
            offset += len(batch)
            if done:
                return
            if not batch:
                await asyncio.sleep(0.025)
        yield "data: " + json.dumps({"type": "expired"}) + "\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        },
    )


def emit(kind, **data):
    row = current.get()
    if row is None or quiet.get():
        return
    with lock:
        if len(row["events"]) >= 160:
            return
        row["events"].append(
            {
                "type": kind,
                "seq": len(row["events"]) + 1,
                "at_ms": round((time.perf_counter() - row["start"]) * 1000, 3),
                **data,
            }
        )


@contextmanager
def step(name, category, explanation, **facts):
    id = uuid.uuid4().hex[:12]
    outer = parent.get()
    emit(
        "step",
        id=id,
        parent=outer,
        name=name,
        category=category,
        explanation=explanation,
        status="running",
        facts=facts,
    )
    token = parent.set(id)
    start = time.perf_counter()
    result = {}
    try:
        yield result
    except Exception:
        emit(
            "update",
            id=id,
            status="rejected",
            duration_ms=round((time.perf_counter() - start) * 1000, 3),
        )
        raise
    else:
        emit(
            "update",
            id=id,
            status=result.pop("status", "complete"),
            duration_ms=round((time.perf_counter() - start) * 1000, 3),
            facts=result,
        )
    finally:
        parent.reset(token)


def observed(name, category, explanation, **facts):
    def decorate(fn):
        @functools.wraps(fn)
        def wrapped(*args, **kwargs):
            with step(name, category, explanation, **facts) as result:
                value = fn(*args, **kwargs)
                if isinstance(value, list):
                    result["records"] = len(value)
                if isinstance(value, bool):
                    result["matched"] = value
                if value is False:
                    result["status"] = "rejected"
                return value

        return wrapped

    return decorate


def commit(db):
    with step(
        "Commit database transaction",
        "storage",
        "PostgreSQL commits the pending changes atomically.",
    ):
        db.commit()


@contextmanager
def private_steps():
    token = quiet.set(True)
    try:
        yield
    finally:
        quiet.reset(token)


def privacy_flow(fn):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        with step(
            "Process recovery policy",
            "identity",
            "Account-specific lookup and delivery details stay private to prevent email enumeration.",
        ):
            token = quiet.set(True)
            try:
                return fn(*args, **kwargs)
            finally:
                quiet.reset(token)

    return wrapped


class TraceMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"].startswith("/observe"):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        id = headers.get(b"x-trace-id", b"").decode("ascii", errors="ignore")
        key = headers.get(b"x-trace-key", b"").decode("ascii", errors="ignore")
        if not id:
            return await self.app(scope, receive, send)
        with lock:
            try:
                row = authorize(id, key)
            except HTTPException:
                row = None
            if row is not None and row["bound"]:
                row = None
            if row is not None:
                row["bound"] = True
                row["path"] = scope["path"]
                row["start"] = time.perf_counter()
        if row is None:
            from starlette.responses import JSONResponse

            return await JSONResponse(
                {"detail": "Invalid or already used live operation."}, status_code=409
            )(scope, receive, send)
        context = current.set(row)
        status = 500

        async def capture(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        emit("request", name=scope["method"] + " " + scope["path"])
        try:
            with step(
                "Process API request",
                "request",
                "FastAPI runs validation, dependencies, the endpoint, and any queued background work.",
                method=scope["method"],
            ) as progress:
                await self.app(scope, receive, capture)
                progress["http_status"] = status
                if status >= 400:
                    progress["status"] = "rejected"
        finally:
            emit(
                "finished",
                status="complete" if status < 400 else "rejected",
                http_status=status,
            )
            with lock:
                row["done"] = True
            current.reset(context)
