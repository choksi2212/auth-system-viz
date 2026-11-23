"use client";
import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useLiveOperations } from "./components/useLiveOperations";
import LiveOperations from "./components/LiveOperations";
import {
  ArrowUpRight,
  Plus,
  Search,
  FileText,
  ShieldCheck,
  Download,
  Trash2,
  Check,
  LogOut,
  FolderLock,
  Activity,
  Settings,
  ArrowLeft,
  Lock,
  KeyRound,
  X,
  Loader2,
} from "lucide-react";
export default function Home() {
  const live = useLiveOperations();
  const [token, T] = useState(null),
    [user, U] = useState(null),
    [mode, M] = useState("login"),
    [pending, P] = useState(null),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [docs, D] = useState([]),
    [events, EV] = useState([]),
    [view, V] = useState("vault"),
    [query, Q] = useState(""),
    [inspect, I] = useState(null),
    [notice, N] = useState(""),
    [ready, R] = useState(false);
  const picker = useRef();
  async function request(path, options = {}, at = token) {
    const res = await live.traceFetch("/api" + path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(at ? { Authorization: "Bearer " + at } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      let d = await res.json().catch(() => ({ detail: "Request failed." }));
      throw Error(
        typeof d.detail === "string"
          ? d.detail
          : d.detail?.[0]?.msg || "Check your details.",
      );
    }
    return res;
  }
  async function refresh() {
    let rt = localStorage.getItem("vellum_rt");
    if (!rt) return null;
    const res = await live.traceFetch(
      "/api/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      },
      true,
    );
    if (!res.ok) {
      localStorage.removeItem("vellum_rt");
      return null;
    }
    const d = await res.json();
    localStorage.setItem("vellum_rt", d.refresh_token);
    T(d.access_token);
    return d.access_token;
  }
  async function load(at = token) {
    const [u, d, e] = await Promise.all(
      ["/users/me", "/vault/documents", "/vault/activity"].map((p) =>
        request(p, {}, at).then((r) => r.json()),
      ),
    );
    U(u);
    D(d);
    EV(e);
  }
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.get("token")) {
        M(location.pathname.includes("reset") ? "reset" : "verify");
      }
      try {
        let t = await refresh();
        if (t) await load(t);
      } catch (e) {
        E(e.message);
      }
      R(true);
    })();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        if (user) {
          gsap.fromTo(
            ".page-heading, .overview, .collection-bar, .document-table, .security-card, .activity-list",
            { opacity: 0, y: 12 },
            {
              opacity: 1,
              y: 0,
              duration: 0.55,
              stagger: 0.055,
              ease: "power2.out",
              clearProps: "all",
            },
          );
        } else {
          gsap.fromTo(
            ".story-copy > *, .form-inner > *",
            { opacity: 0, y: 10 },
            {
              opacity: 1,
              y: 0,
              duration: 0.65,
              stagger: 0.04,
              ease: "power2.out",
              clearProps: "all",
            },
          );
        }
      });
      return () => ctx.revert();
    });
    return () => media.revert();
  }, [ready, !!user, view, mode]);
  useEffect(() => {
    if (!inspect) return;
    const previous = document.activeElement;
    const close = document.querySelector(".close");
    close?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") I(null);
      if (e.key === "Tab") {
        const buttons = document.querySelectorAll(".inspector button");
        if (e.shiftKey && document.activeElement === buttons[0]) {
          e.preventDefault();
          buttons[buttons.length - 1]?.focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === buttons[buttons.length - 1]
        ) {
          e.preventDefault();
          buttons[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() =>
        gsap.fromTo(
          ".inspector",
          { x: 40, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.35,
            ease: "power2.out",
            clearProps: "all",
          },
        ),
      );
      return () => ctx.revert();
    });
    return () => {
      media.revert();
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [!!inspect]);
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(
      async () => {
        try {
          await refresh();
        } catch {}
      },
      10 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, [token]);
  async function auth(e) {
    e.preventDefault();
    B(true);
    E("");
    const f = Object.fromEntries(new FormData(e.target));
    try {
      let endpoint =
        mode === "login"
          ? "/auth/login"
          : mode === "signup"
            ? "/auth/signup"
            : mode === "forgot"
              ? "/auth/forgot-password"
              : mode === "otp"
                ? "/auth/verify-otp"
                : mode === "reset"
                  ? "/auth/reset-password"
                  : mode === "resend"
                    ? "/auth/resend-verification"
                    : "/auth/verify-email";
      if (mode === "otp") f.pending_token = pending;
      if (mode === "reset" || mode === "verify")
        f.token = new URLSearchParams(location.search).get("token");
      const d = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(f),
      }).then((r) => r.json());
      if (d.requires_otp) {
        P(d.pending_token);
        M("otp");
      } else if (d.access_token) {
        T(d.access_token);
        localStorage.setItem("vellum_rt", d.refresh_token);
        await load(d.access_token);
      } else {
        N(d.message);
        M("login");
        history.replaceState({}, "", "/");
      }
    } catch (e) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  async function action(fn) {
    B(true);
    E("");
    try {
      await fn();
    } catch (e) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  async function upload(files) {
    if (!files?.length || busy) return;
    await action(async () => {
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024)
          throw Error("Files must be 20 MB or smaller.");
        const form = new FormData();
        form.append("file", f);
        await request("/vault/documents", { method: "POST", body: form });
      }
      await load();
      N("Your documents are encrypted and stored.");
    });
    if (picker.current) picker.current.value = "";
  }
  async function logout() {
    await action(async () => {
      await request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({
          refresh_token: localStorage.getItem("vellum_rt"),
        }),
      });
      localStorage.removeItem("vellum_rt");
      T(null);
      U(null);
      D([]);
      N("");
      E("");
      P(null);
      M("login");
      V("vault");
    });
  }
  const size = (n) =>
    Number(n) < 1024
      ? `${n} B`
      : Number(n) < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
  const date = (d) =>
    new Date(d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (!ready)
    return (
      <div className="loading">
        <Loader2 className="spin" /> Opening Cryptrace
      </div>
    );
  return (
    <div className={live.open ? "application observing" : "application"}>
      {!user ? (
        <main className="auth">
          <div className="auth-story">
            <a className="brand" href="/">
              cryptrace
            </a>
            <div className="story-copy">
              <span className="eyebrow">A PRIVATE PLACE FOR WHAT MATTERS</span>
              <h1>
                Some things <br />
                are yours. <br />
                <em>Keep them so.</em>
              </h1>
              <p>
                A considered home for your important documents.
                <br />
                Encrypted, signed, and always under your control.
              </p>
              <div className="seal">
                <ShieldCheck size={20} /> Private by design. Protected by
                mathematics.
              </div>
            </div>
            <div className="story-bottom">
              YOUR DOCUMENTS. YOUR SPACE.<span>EST. 2026</span>
            </div>
          </div>
          <div className="auth-form">
            <div className="form-inner">
              <span className="eyebrow">WELCOME TO CRYPTRACE</span>
              <h2>
                {
                  {
                    login: "Your private space awaits.",
                    signup: "Make room for what matters.",
                    forgot: "A fresh start.",
                    otp: "One more layer.",
                    reset: "Choose a new password.",
                    verify: "Confirm your email.",
                    resend: "Another invitation.",
                  }[mode]
                }
              </h2>
              <p className="muted">
                {mode === "login"
                  ? "Sign in to your encrypted document workspace."
                  : mode === "otp"
                    ? "Enter the six-digit code delivered to your email."
                    : "Your security starts with a few details."}
              </p>
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              {notice && (
                <div className="notice" role="status">
                  {notice}
                </div>
              )}
              <form onSubmit={auth}>
                {["login", "signup", "forgot", "resend"].includes(mode) && (
                  <label>
                    Email address
                    <input
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </label>
                )}
                {mode === "signup" && (
                  <label>
                    Username
                    <input
                      name="username"
                      required
                      minLength={3}
                      maxLength={30}
                      pattern="[a-zA-Z0-9_]+"
                      placeholder="Your name"
                    />
                  </label>
                )}
                {["login", "signup", "reset"].includes(mode) && (
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={mode === "login" ? 1 : 8}
                      placeholder="Enter your password"
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                    />
                  </label>
                )}
                {["signup", "reset"].includes(mode) && (
                  <>
                    <p className="hint">
                      8–72 characters with uppercase, lowercase, a number and a
                      symbol.
                    </p>
                    <label>
                      Confirm password
                      <input
                        name="confirm_password"
                        type="password"
                        required
                        placeholder="Repeat your password"
                      />
                    </label>
                  </>
                )}
                {mode === "otp" && (
                  <label>
                    Verification code
                    <input
                      name="otp"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      placeholder="000000"
                    />
                  </label>
                )}
                {mode === "login" && (
                  <button
                    type="button"
                    className="text-link forgot"
                    onClick={() => {
                      M("forgot");
                      E("");
                      N("");
                    }}
                  >
                    Forgot password?
                  </button>
                )}
                <button className="primary wide" disabled={busy}>
                  {busy ? (
                    <Loader2 size={16} className="spin" />
                  ) : mode === "login" ? (
                    "Sign in"
                  ) : mode === "signup" ? (
                    "Create account"
                  ) : (
                    "Continue"
                  )}
                  <ArrowUpRight size={17} />
                </button>
              </form>
              <p className="switch">
                {mode === "login" ? (
                  <>
                    New to Cryptrace?{" "}
                    <button
                      onClick={() => {
                        M("signup");
                        E("");
                        N("");
                      }}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      M("login");
                      E("");
                      N("");
                    }}
                  >
                    Back to sign in
                  </button>
                )}
              </p>
              {mode === "login" && (
                <button
                  className="text-link"
                  onClick={() => {
                    M("resend");
                    E("");
                    N("");
                  }}
                >
                  Resend verification email
                </button>
              )}
              <div className="auth-foot">
                <Lock size={13} /> Encrypted storage. No compromises.
              </div>
            </div>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside>
            <a href="/" className="brand">
              cryptrace
            </a>
            <div className="workspace-label">PERSONAL WORKSPACE</div>
            <nav>
              {[
                ["vault", FolderLock, "My vault"],
                ["activity", Activity, "Activity"],
                ["security", ShieldCheck, "Security"],
              ].map(([id, Icon, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    V(id);
                    E("");
                    N("");
                  }}
                  className={view === id ? "active" : ""}
                >
                  <Icon size={18} />
                  {label}
                  {id === "vault" && <small>{docs.length}</small>}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="private-note">
                <Lock size={17} />
                <p>
                  A little more private.
                  <br />
                  <span>Every file. Every time.</span>
                </p>
              </div>
              <div className="profile">
                <div className="avatar">
                  {user.username?.[0]?.toUpperCase()}
                </div>
                <div>
                  <strong>{user.username}</strong>
                  <span>{user.email}</span>
                </div>
                <button title="Sign out" onClick={logout}>
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </aside>
          <main className="main">
            <header>
              <div className="breadcrumb">
                Workspace <span>/</span>{" "}
                <b>
                  {view === "vault"
                    ? "My vault"
                    : view === "activity"
                      ? "Activity"
                      : "Security"}
                </b>
              </div>
              <span className="secured">
                <i /> STORAGE PROTECTED
              </span>
            </header>
            <div className="content">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {view === "vault"
                      ? "YOUR PERSONAL ARCHIVE"
                      : view === "activity"
                        ? "A RECORD OF YOUR WORKSPACE"
                        : "PROTECTION, EXPLAINED"}
                  </span>
                  <h1>
                    {view === "vault"
                      ? "A space of your own."
                      : view === "activity"
                        ? "Nothing goes unnoticed."
                        : "Trust, with evidence."}
                  </h1>
                  <p className="muted">
                    {view === "vault"
                      ? "Everything important, quietly protected."
                      : view === "activity"
                        ? "A traceable history of your document operations."
                        : "Real cryptography. Clear boundaries. Complete visibility."}
                  </p>
                </div>
                {view === "vault" && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => picker.current.click()}
                  >
                    <Plus size={17} /> Add document
                  </button>
                )}
              </div>
              {error && (
                <div className="alert" role="alert">
                  {error}
                  <button aria-label="Dismiss error" onClick={() => E("")}>
                    <X size={15} />
                  </button>
                </div>
              )}
              {notice && (
                <div className="notice" role="status">
                  {notice}
                  <button
                    aria-label="Dismiss notification"
                    onClick={() => N("")}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              {view === "vault" && (
                <>
                  <div className="overview">
                    <div>
                      <span>DOCUMENTS</span>
                      <strong>{String(docs.length).padStart(2, "0")}</strong>
                      <p>In your private collection</p>
                    </div>
                    <div>
                      <span>STORAGE USED</span>
                      <strong>
                        {size(
                          docs.reduce((a, d) => a + Number(d.size) + 28, 0),
                        )}
                      </strong>
                      <p>Encrypted document bytes</p>
                    </div>
                    <div className="protection">
                      <ShieldCheck size={24} />
                      <div>
                        <strong>Protected. By default.</strong>
                        <p>AES-256 encryption & digital signatures.</p>
                      </div>
                    </div>
                  </div>
                  <div className="collection-bar">
                    <h3>
                      Your collection <span>{docs.length}</span>
                    </h3>
                    <div className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search documents"
                        placeholder="Find a document…"
                        value={query}
                        onChange={(e) => Q(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="document-table">
                    <div className="table-head">
                      <span>NAME</span>
                      <span>ADDED</span>
                      <span>SIZE</span>
                      <span>ACTIONS</span>
                    </div>
                    {docs
                      .filter((d) =>
                        d.name.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((d) => (
                        <div className="doc-row" key={d.id}>
                          <button className="doc-name" onClick={() => I(d)}>
                            <span className="file-icon">
                              <FileText size={20} />
                            </span>
                            <span>
                              <b>{d.name}</b>
                              <small>Encrypted · Signed</small>
                            </span>
                          </button>
                          <span>{date(d.created_at)}</span>
                          <span>{size(d.size)}</span>
                          <div className="row-actions">
                            <button
                              title="Verify integrity"
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  const v = await request(
                                    "/vault/documents/" + d.id + "/verify",
                                    { method: "POST" },
                                  ).then((r) => r.json());
                                  I({ ...d, verified: v.verified });
                                  await load();
                                })
                              }
                            >
                              <ShieldCheck size={17} />
                            </button>
                            <button
                              title="Download document"
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  const blob = await request(
                                    "/vault/documents/" + d.id + "/download",
                                  ).then((r) => r.blob());
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = d.name;
                                  a.click();
                                  setTimeout(
                                    () => URL.revokeObjectURL(url),
                                    1000,
                                  );
                                  await load();
                                })
                              }
                            >
                              <Download size={17} />
                            </button>
                            <button
                              title="Delete document"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm("Permanently delete " + d.name + "?")
                                )
                                  action(async () => {
                                    await request("/vault/documents/" + d.id, {
                                      method: "DELETE",
                                    });
                                    await load();
                                    N("Document permanently deleted.");
                                  });
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    {!docs.length && (
                      <div className="empty">
                        <FolderLock size={36} />
                        <h2>Your next chapter starts here.</h2>
                        <p>
                          Add your first document. We’ll take care of the
                          encryption.
                        </p>
                        <button
                          className="text-link"
                          onClick={() => picker.current.click()}
                        >
                          Choose a document <ArrowUpRight size={15} />
                        </button>
                      </div>
                    )}
                    {docs.length > 0 &&
                      !docs.some((d) =>
                        d.name.toLowerCase().includes(query.toLowerCase()),
                      ) && (
                        <div className="empty">
                          No documents match your search.
                        </div>
                      )}
                  </div>
                  <button
                    className="dropzone"
                    disabled={busy}
                    onClick={() => picker.current.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      upload(e.dataTransfer.files);
                    }}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={22} />
                    ) : (
                      <Plus size={22} />
                    )}
                    <span>
                      <b>
                        {busy
                          ? "Protecting your documents…"
                          : "Drop something important here."}
                      </b>
                      <small>
                        Or click to browse · Any file type · Up to 20 MB per
                        file
                      </small>
                    </span>
                    <ArrowUpRight size={19} />
                  </button>
                  <div className="footnote">
                    <Lock size={13} /> Files are encrypted before being written
                    to storage.<span>MADE FOR PEACE OF MIND.</span>
                  </div>
                </>
              )}
              {view === "activity" && (
                <div className="activity-list">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        const result = await request(
                          "/vault/audit/verify",
                        ).then((r) => r.json());
                        N(
                          "Activity integrity verified · " +
                            result.records +
                            " records checked.",
                        );
                      })
                    }
                  >
                    <ShieldCheck size={16} /> Verify activity history
                  </button>
                  {events.length ? (
                    events.map((e) => (
                      <div className="event" key={e.id}>
                        <span className="file-icon">
                          <Activity size={18} />
                        </span>
                        <div>
                          <b>{e.action}</b>
                          <p>{e.name}</p>
                          <code>{e.digest.slice(0, 28)}…</code>
                        </div>
                        <time>{new Date(e.created_at).toLocaleString()}</time>
                      </div>
                    ))
                  ) : (
                    <div className="empty">
                      <Activity size={32} />
                      <h2>A clean slate.</h2>
                      <p>Your document activity will appear here.</p>
                    </div>
                  )}
                </div>
              )}
              {view === "security" && (
                <>
                  <div className="security-grid">
                    {[
                      [
                        "01",
                        "Encrypted storage",
                        "A unique AES-256-GCM key and random nonce protect each document. Authentication tags reject altered ciphertext.",
                      ],
                      [
                        "02",
                        "Protected keys",
                        "Each file key is wrapped with RSA-3072 OAEP using SHA-256. The server identity remains in the persistent data volume.",
                      ],
                      [
                        "03",
                        "Document signatures",
                        "RSA-PSS signatures and SHA-256 digests verify the original document before every download.",
                      ],
                      [
                        "04",
                        "Traceable activity",
                        "Document events form an HMAC-SHA256 chain. Verify the history to detect changes to stored event records.",
                      ],
                    ].map(([n, t, p]) => (
                      <div className="security-card" key={n}>
                        <span>{n}</span>
                        <h2>{t}</h2>
                        <p>{p}</p>
                      </div>
                    ))}
                  </div>
                  <div className="account-security">
                    <div>
                      <h3>Email two-factor authentication</h3>
                      <p>Require a six-digit email code when signing in.</p>
                    </div>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await request(
                            "/users/2fa/" +
                              (user.is_2fa_enabled ? "disable" : "enable"),
                            { method: "POST" },
                          );
                          await load();
                          N("Authentication preference updated.");
                        })
                      }
                    >
                      {user.is_2fa_enabled ? "Disable" : "Enable"} 2FA
                    </button>
                  </div>
                  <p className="muted boundary">
                    The server manages decryption keys. This protects stored
                    files; it is not end-to-end encryption. Local Docker traffic
                    uses HTTP. Use HTTPS when hosting publicly.
                  </p>
                </>
              )}
            </div>
          </main>
          <input
            type="file"
            hidden
            multiple
            ref={picker}
            onChange={(e) => upload(e.target.files)}
          />
          {inspect && (
            <div className="overlay" onClick={() => I(null)}>
              <section
                role="dialog"
                aria-modal="true"
                aria-label="Document details"
                className="inspector"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  aria-label="Close document details"
                  className="close"
                  onClick={() => I(null)}
                >
                  <X />
                </button>
                <span className="eyebrow">DOCUMENT DETAILS</span>
                <FileText size={36} />
                <h2>{inspect.name}</h2>
                <p className="muted">
                  {size(inspect.size)} · {date(inspect.created_at)}
                </p>
                {inspect.verified && (
                  <div className="notice">
                    <Check size={16} /> Signature and integrity verified.
                  </div>
                )}
                <label>
                  CONTENT FINGERPRINT · SHA-256<code>{inspect.digest}</code>
                </label>
                <label>
                  ENCRYPTION<p>AES-256-GCM</p>
                </label>
                <label>
                  KEY PROTECTION<p>RSA-3072 / OAEP-SHA256</p>
                </label>
                <label>
                  DIGITAL SIGNATURE<p>RSA-PSS / SHA-256</p>
                </label>
                <button
                  className="primary wide"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request(
                        "/vault/documents/" + inspect.id + "/verify",
                        { method: "POST" },
                      );
                      I({ ...inspect, verified: true });
                      await load();
                    })
                  }
                >
                  <ShieldCheck size={17} /> Verify document
                </button>
              </section>
            </div>
          )}
        </div>
      )}
      <LiveOperations live={live} />
    </div>
  );
}
