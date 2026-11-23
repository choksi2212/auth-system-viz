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
      setOperations((all) =>
        [
          {
            id: trace.id,
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
      const stream = await fetch(`/api/observe/${trace.id}/events`, {
        headers: { "X-Trace-Key": trace.key },
        signal: controller.signal,
      });
      if (!stream.ok) throw Error("Live event channel unavailable");
      (async () => {
        try {
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
              update(trace.id, (op) => {
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
                }
                if (event.type === "expired")
                  next.channelError = "The live channel expired.";
                return next;
              });
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
          controllers.current.delete(controller);
        }
      })();
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          "X-Trace-Id": trace.id,
          "X-Trace-Key": trace.key,
        },
      });
    } catch (e) {
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
