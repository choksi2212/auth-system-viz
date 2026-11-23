"use client";
import { useState, useRef, useEffect, useCallback } from "react";
export function useLiveOperations() {
  const [operations, setOperations] = useState([]),
    [selected, setSelected] = useState(null),
    [open, setOpen] = useState(false);
  const controllers = useRef(new Set());
  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort();
    },
    [],
  );
  const update = useCallback(
    (id, change) =>
      setOperations((all) => all.map((op) => (op.id === id ? change(op) : op))),
    [],
  );
  async function traceFetch(url, options = {}, background = false) {
    const path = url.replace("/api", "");
    const passive =
      (options.method || "GET") === "GET" &&
      ["/users/me", "/vault/documents", "/vault/activity"].includes(path);
    const meaningful =
      passive ||
      path.startsWith("/auth/") ||
      path.startsWith("/users/2fa/") ||
      path.startsWith("/vault/documents/") ||
      path === "/vault/audit/verify" ||
      (path === "/vault/documents" && options.method === "POST");
    if (!meaningful) return fetch(url, options);
    let trace;
    let sent = false;
    try {
      const start = await fetch("/api/observe/traces", { method: "POST" });
      if (!start.ok) throw Error("Live event channel unavailable");
      trace = await start.json();
      const title = passive
        ? {
            "/users/me": "Load account profile",
            "/vault/documents": "List owned documents",
            "/vault/activity": "Read document activity",
          }[path]
        : path.startsWith("/auth/")
          ? {
              login: "Sign in",
              signup: "Create account",
              "verify-email": "Verify email",
              "verify-otp": "Verify one-time code",
              refresh: "Refresh session",
              logout: "Sign out",
              "forgot-password": "Password recovery",
              "reset-password": "Reset password",
              "resend-verification": "Resend verification",
            }[path.split("/").pop()]
          : path.includes("/2fa/")
            ? "Update two-factor policy"
            : path.includes("/download")
              ? "Decrypt and download"
              : path.includes("/audit/")
                ? "Verify activity chain"
                : path.includes("/verify")
                  ? "Verify document"
                  : options.method === "DELETE"
                    ? "Delete document"
                    : "Encrypt document";
      let local = null;
      if (options.body instanceof FormData) {
        const file = options.body.get("file");
        if (file instanceof File) {
          const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
          local = {
            hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
              "",
            ),
            name: file.name,
            size: file.size,
            source: "Selected file in this browser",
          };
        }
      }
      setOperations((all) =>
        [
          {
            id: trace.id,
            local,
            title,
            path,
            status: "waiting",
            steps: [],
            started: new Date().toISOString(),
            events: [],
          },
          ...all,
        ].slice(0, 32),
      );
      if (!passive && !background) {
        setSelected(trace.id);
        setOpen(true);
      }
      const controller = new AbortController();
      controllers.current.add(controller);
      // Dispatch the action before opening its replayable event stream, so
      // passive streams cannot reserve every browser connection ahead of it.
      sent = true;
      const request = fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          "X-Trace-Id": trace.id,
          "X-Trace-Key": trace.key,
        },
      });
      const ingest = (event) =>
        update(trace.id, (op) => {
          if (op.events.some((e) => e.seq === event.seq)) return op;
          const next = { ...op, events: [...op.events, event] };
          if (event.type === "request") next.status = "running";
          if (event.type === "step") next.steps = [...op.steps, event];
          if (event.type === "update")
            next.steps = op.steps.map((s) =>
              s.id === event.id
                ? {
                    ...s,
                    ...event,
                    facts: { ...s.facts, ...event.facts },
                    at_ms: s.at_ms,
                  }
                : s,
            );
          if (event.type === "finished") {
            next.status = event.status;
            next.duration = event.at_ms;
            next.http = event.http_status;
            next.channelError = null;
          }
          if (event.type === "expired")
            next.channelError = "The live channel expired.";
          return next;
        });
      const reconcile = async () => {
        const res = await fetch(`/api/observe/${trace.id}`, {
          headers: { "X-Trace-Key": trace.key },
          signal: controller.signal,
        });
        if (!res.ok) throw Error("Live event snapshot unavailable");
        const snapshot = await res.json();
        snapshot.events.forEach(ingest);
        return snapshot.done;
      };
      (async () => {
        try {
          const stream = await fetch(`/api/observe/${trace.id}/events`, {
            headers: { "X-Trace-Key": trace.key },
            signal: controller.signal,
          });
          if (!stream.ok) throw Error("Live event channel unavailable");
          const reader = stream.body.getReader(),
            decoder = new TextDecoder();
          let pending = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = pending.indexOf("\n\n")) >= 0) {
              const frame = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              if (!frame.startsWith("data: ")) continue;
              const event = JSON.parse(frame.slice(6));
              ingest(event);
              if (event.type === "finished" || event.type === "expired") {
                await reader.cancel();
                return;
              }
            }
          }
        } catch (e) {
          if (e.name !== "AbortError")
            update(trace.id, (op) => ({
              ...op,
              channelError:
                "Event stream disconnected. No steps have been inferred.",
            }));
        } finally {
          // Replay the authoritative event buffer after EOF or a disconnect.
          // Completion is taken only from a real server finished event.
          try {
            await request.catch(() => {});
            for (
              let retry = 0;
              retry < 20 && !controller.signal.aborted;
              retry++
            ) {
              if (await reconcile()) break;
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          } catch (_) {}
          controllers.current.delete(controller);
        }
      })();
      const response = await request;
      if (path.endsWith("/download") && response.ok) {
        const reader = response.clone().body.getReader();
        const { value } = await reader.read();
        reader.cancel().catch(() => {});
        const bytes = (value || new Uint8Array()).slice(0, 32);
        update(trace.id, (op) => ({
          ...op,
          local: {
            hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
              "",
            ),
            source: "Verified download in this browser",
            size: Number(response.headers.get("content-length")),
          },
        }));
      }
      return response;
    } catch (e) {
      if (sent) throw e;
      if (trace)
        update(trace.id, (op) => ({
          ...op,
          channelError:
            "Live telemetry is unavailable. The request proceeds normally.",
        }));
      return fetch(url, options);
    }
  }
  return { operations, selected, setSelected, open, setOpen, traceFetch };
}
