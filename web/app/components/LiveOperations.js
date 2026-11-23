"use client";
import { useEffect, useState, useRef } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Download,
  Radio,
  X,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { gsap } from "gsap";
import TransformationView from "./TransformationView";
const categoryNames = {
  request: "Request",
  identity: "Identity",
  crypto: "Cryptography",
  storage: "Storage",
  delivery: "Email",
};
const duration = (n) =>
  n == null ? "—" : n < 1 ? `${n.toFixed(3)} ms` : `${n.toFixed(2)} ms`;
export default function LiveOperations({ live }) {
  const [selectedStep, selectStep] = useState(null);
  const panel = useRef(null);
  const op =
    live.operations.find((o) => o.id === live.selected) || live.operations[0];
  const steps = op?.steps || [];
  const selected =
    steps.find((s) => s.id === selectedStep) ||
    [...steps].reverse().find((s) => s.status === "running") ||
    steps.at(-1);
  useEffect(() => {
    selectStep(null);
    const body = panel.current?.querySelector(".live-body");
    if (body) body.scrollTop = 0;
  }, [op?.id]);
  useEffect(() => {
    if (!live.open) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const tween = gsap.fromTo(
        panel.current,
        { x: 24, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.3,
          ease: "power2.out",
          clearProps: "all",
        },
      );
      return () => tween.kill();
    });
    return () => media.revert();
  }, [live.open]);
  useEffect(() => {
    if (!live.open) return;
    const previous = document.activeElement;
    panel.current?.querySelector("button")?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        live.setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll(
        "button,select,input,summary,a[href]",
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [live.open]);
  function exportTrace() {
    if (!op) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...op, local: undefined }, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `vellum-operation-${op.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      {!live.open && (
        <button className="live-launcher" onClick={() => live.setOpen(true)}>
          <Radio size={16} />
          <span>Live process</span>
          {op && <small>{op.steps.length} steps</small>}
        </button>
      )}
      {live.open && (
        <section
          className="live-panel"
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label="Live backend visualization"
        >
          <div className="live-top">
            <div>
              <span className="eyebrow">UNDER THE SURFACE</span>
              <h2>Inside the operation.</h2>
            </div>
            <button
              className="live-close"
              aria-label="Close live view"
              onClick={() => live.setOpen(false)}
            >
              <X size={19} />
            </button>
          </div>
          <div className="live-body">
            <div className="live-source">
              <Radio size={13} />
              <span>REAL SERVER EVENTS</span>
              <b>
                {op?.status === "running"
                  ? "Receiving live"
                  : op?.status === "waiting"
                    ? "Connecting"
                    : op
                      ? "Recorded execution"
                      : "Ready"}
              </b>
            </div>
            {live.operations.length > 0 ? (
              <>
                <label className="operation-label">
                  OPERATION
                  <select
                    aria-label="Observed operation"
                    value={op.id}
                    onChange={(e) => live.setSelected(e.target.value)}
                  >
                    {live.operations.map((o) => (
                      <option value={o.id} key={o.id}>
                        {o.title} · {new Date(o.started).toLocaleTimeString()}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="operation-summary">
                  <h3>{op.title}</h3>
                  <span
                    role="status"
                    aria-live="polite"
                    className={"operation-status " + op.status}
                  >
                    {op.status === "running" || op.status === "waiting" ? (
                      <Loader2 size={13} className="spin" />
                    ) : op.status === "complete" ? (
                      <Check size={13} />
                    ) : (
                      <X size={13} />
                    )}{" "}
                    {op.status === "complete"
                      ? "Completed"
                      : op.status === "rejected"
                        ? "Rejected"
                        : op.status === "running"
                          ? "Running"
                          : "Waiting"}
                  </span>
                </div>
                <div className="execution-metrics">
                  <div>
                    <span>SERVER TIME</span>
                    <strong>{duration(op.duration)}</strong>
                  </div>
                  <div>
                    <span>OBSERVED STEPS</span>
                    <strong>{steps.length}</strong>
                  </div>
                  <div>
                    <span>HTTP RESULT</span>
                    <strong>{op.http || "—"}</strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="live-empty">
                <Activity size={25} />
                <h3>One action. An open view.</h3>
                <p>
                  Sign in, create an account, or work with a document. This view
                  opens automatically and receives events from the code doing
                  the work.
                </p>
              </div>
            )}
            <TransformationView op={op} operations={live.operations} />
            {op?.channelError && (
              <div className="alert" role="status">
                {op.channelError}
              </div>
            )}
            <details className="technical-details">
              <summary>
                Measured execution log · {steps.length} server steps
              </summary>
              {selected && (
                <div className={"step-inspection " + selected.status}>
                  <div className="step-inspection-heading">
                    <span>
                      {categoryNames[selected.category] || selected.category}
                    </span>
                    <b>{duration(selected.duration_ms)}</b>
                  </div>
                  <h3>{selected.name}</h3>
                  <p>{selected.explanation}</p>
                  {Object.keys(selected.facts || {}).length > 0 && (
                    <dl>
                      {Object.entries(selected.facts).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key.replaceAll("_", " ")}</dt>
                          <dd>
                            {typeof value === "boolean"
                              ? value
                                ? "Yes"
                                : "No"
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
              {steps.length > 0 && (
                <div className="execution-timeline">
                  <div className="timeline-heading">
                    <span>EXECUTION LOG</span>
                    <span>ACTUAL SERVER TIMESTAMPS</span>
                  </div>
                  {steps.map((s, i) => (
                    <button
                      className={
                        "execution-step " +
                        s.status +
                        (selected?.id === s.id ? " selected" : "")
                      }
                      key={s.id}
                      onClick={() => selectStep(s.id)}
                    >
                      <span className="step-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="step-copy">
                        <b>{s.name}</b>
                        <small>
                          +{duration(s.at_ms)} ·{" "}
                          {categoryNames[s.category] || s.category}
                        </small>
                      </span>
                      <span className="step-result">
                        {s.status === "running" ? (
                          <Loader2 size={13} className="spin" />
                        ) : s.status === "rejected" ? (
                          <X size={13} />
                        ) : (
                          <Check size={13} />
                        )}
                        <small>{duration(s.duration_ms)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </details>
            <div className="trace-privacy">
              <ShieldCheck size={15} />
              <p>
                Passwords, OTPs, raw tokens and private keys never enter the
                event stream. Recovery flows withhold account-specific details.
              </p>
            </div>
            {op && (
              <button className="trace-export" onClick={exportTrace}>
                <Download size={14} /> Export measured trace{" "}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
