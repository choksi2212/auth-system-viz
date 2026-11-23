"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Lock,
  ShieldCheck,
  X,
  KeyRound,
  Database,
  Mail,
  FileText,
} from "lucide-react";
import { gsap } from "gsap";
const bytes = (hex) => (hex || "").match(/.{1,2}/g) || [];
const facts = (steps, name) => steps.find((s) => s.name === name)?.facts || {};
const item = (steps, name) => steps.find((s) => s.name === name);
function ByteGrid({ hex, selected, onSelect, label, source, tone = "" }) {
  const list = bytes(hex);
  const Cell = onSelect ? "button" : "span";
  return (
    <section className={"byte-panel " + tone}>
      <div className="byte-panel-head">
        <h4>{label}</h4>
        <small>{source}</small>
      </div>
      <div className="byte-grid">
        {list.map((b, i) => (
          <Cell
            tabIndex={onSelect ? (selected === i ? 0 : -1) : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    const delta = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -8,
                      ArrowDown: 8,
                    }[e.key];
                    if (delta) {
                      e.preventDefault();
                      const next = (i + delta + list.length) % list.length;
                      onSelect(next);
                      e.currentTarget.parentElement.children[next]?.focus();
                    }
                  }
                : undefined
            }
            aria-label={`${label} byte ${i}: ${b}`}
            aria-pressed={selected === i}
            className={selected === i ? "picked" : ""}
            onClick={() => onSelect?.(i)}
            key={i}
          >
            <span>{i.toString().padStart(2, "0")}</span>
            <b>{b}</b>
          </Cell>
        ))}
      </div>
      {!list.length && (
        <div className="byte-pending">
          No byte preview available for this operation
        </div>
      )}
    </section>
  );
}
function SecretBox({ title, caption, fingerprint }) {
  return (
    <div className="secret-box">
      <Lock size={18} />
      <span>
        <b>{title}</b>
        <small>{caption}</small>
        {fingerprint && <code>{fingerprint}</code>}
      </span>
    </div>
  );
}
function Result({ accepted, children }) {
  return (
    <div className={"mechanism-result " + (accepted === false ? "failed" : "")}>
      {accepted === false ? (
        <X size={18} />
      ) : accepted === true ? (
        <Check size={18} />
      ) : (
        <span className="pending-dot" />
      )}
      <span>{children}</span>
    </div>
  );
}
function Bits({ value, label, tone = "" }) {
  const binary =
    value == null
      ? "????????"
      : parseInt(value, 16).toString(2).padStart(8, "0");
  return (
    <div className={"bit-row " + tone}>
      <span>{label}</span>
      <div>
        {[...binary].map((v, i) => (
          <b className={v === "1" ? "one" : ""} key={i}>
            {v}
          </b>
        ))}
      </div>
      <code>{value || "—"}</code>
    </div>
  );
}
function Encryption({ op, operations }) {
  const steps = op.steps,
    encrypt = facts(steps, "Encrypt document with AES-GCM"),
    read = facts(steps, "Read encrypted envelope"),
    counters = {
      ...facts(steps, "Read encrypted envelope"),
      ...facts(steps, "Calculate the first counter blocks"),
    },
    nonce = facts(steps, "Generate GCM nonce"),
    key = {
      ...facts(steps, "Unwrap document key"),
      ...facts(steps, "Generate per-file AES key"),
    };
  const inverse = op.path.includes("/download") || op.path.endsWith("/verify");
  const id = op.path.split("/")[3];
  const previous = operations.find(
    (o) =>
      facts(o.steps, "Encrypt document with AES-GCM").document_id === id &&
      o.local,
  );
  const local = inverse ? op.local : op.local || previous?.local;
  const plain = bytes(local?.hex);
  const cipherHex = encrypt.ciphertext_window || read.ciphertext_window || "";
  const cipher = bytes(cipherHex);
  const stream = plain.map((p, i) =>
    cipher[i]
      ? (parseInt(p, 16) ^ parseInt(cipher[i], 16))
          .toString(16)
          .padStart(2, "0")
      : null,
  );
  const [selected, select] = useState(0),
    [tab, Tab] = useState(op.path.endsWith("/verify") ? "envelope" : "bytes");
  const board = useRef(null);
  useEffect(() => {
    select(0);
    Tab(op.path.endsWith("/verify") ? "envelope" : "bytes");
  }, [op.id]);
  useEffect(() => {
    if (
      !board.current ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const t = gsap.fromTo(
      board.current.querySelectorAll(".byte-grid button,.bit-row b"),
      { y: 4 },
      { y: 0, duration: 0.18, stagger: 0.003, clearProps: "all" },
    );
    return () => t.kill();
  }, [cipherHex]);
  const nonceHex = nonce.nonce_hex || read.nonce_hex;
  const tag = encrypt.tag_hex || read.tag_hex;
  const accepted =
    encrypt.xor_verified === true ||
    item(steps, "Authenticate and decrypt")?.status === "complete";
  return (
    <div className="mechanism-workbench" ref={board}>
      <div className="mechanism-intro">
        <div>
          <span className="eyebrow">
            {inverse ? "CIPHERTEXT → VERIFIED FILE" : "FILE BYTES → CIPHERTEXT"}
          </span>
          <h2>
            {inverse
              ? "Recover the original. Verify every byte."
              : "Watch the bytes change."}
          </h2>
          <p>
            {inverse
              ? "The same counter stream reverses the XOR. GCM authentication and the document signature must both pass."
              : "AES-GCM encrypts nonce-derived counters, then XORs their output with your file. These values come from this operation."}
          </p>
        </div>
        <div
          className="mechanism-tabs"
          role="group"
          aria-label="Encryption explanation"
        >
          <button
            className={tab === "bytes" ? "active" : ""}
            onClick={() => Tab("bytes")}
          >
            Byte transformation
          </button>
          <button
            className={tab === "keys" ? "active" : ""}
            onClick={() => Tab("keys")}
          >
            Keys & signature
          </button>
          <button
            className={tab === "envelope" ? "active" : ""}
            onClick={() => Tab("envelope")}
          >
            Stored envelope
          </button>
        </div>
      </div>
      {tab === "bytes" && (
        <>
          <div className="counter-pipeline">
            <div className="counter-input">
              <small>NONCE · 96 BITS</small>
              <code>{nonceHex || "Waiting for nonce"}</code>
              <div className="counter-blocks">
                {(
                  counters.counter_blocks || [
                    nonceHex ? nonceHex + "00000002" : null,
                  ]
                )
                  .filter(Boolean)
                  .map((c, i) => (
                    <div key={c}>
                      <span>Counter {i + 2}</span>
                      <code>
                        {c.slice(0, 24)}
                        <b>{c.slice(24)}</b>
                      </code>
                    </div>
                  ))}
              </div>
            </div>
            <ArrowRight />
            <div className="aes-engine">
              <KeyRound size={25} />
              <strong>AES-256</strong>
              <small>256-bit per-file key · 14 rounds</small>
              <span>Counter blocks in → encrypted stream out</span>
            </div>
            <ArrowRight />
            <SecretBox
              title="Per-file key stays private"
              caption="The displayed counter calculation is checked against the real ciphertext."
              fingerprint={key.fingerprint}
            />
          </div>
          <div className="xor-lanes">
            <ByteGrid
              hex={inverse ? cipherHex : local?.hex}
              selected={selected}
              onSelect={select}
              label={inverse ? "Stored ciphertext" : "Your file bytes"}
              source={
                inverse
                  ? "Actual encrypted file · server"
                  : local?.source || "Plaintext stays in your browser"
              }
            />
            <div className="xor-operator">
              <span>⊕</span>
              <small>XOR</small>
            </div>
            <ByteGrid
              hex={stream.filter(Boolean).join("")}
              selected={selected}
              onSelect={select}
              label="AES counter output"
              source="Derived locally from the actual input and output"
              tone="stream"
            />
            <div className="xor-operator equals">
              <span>=</span>
            </div>
            <ByteGrid
              hex={inverse ? local?.hex : cipherHex}
              selected={selected}
              onSelect={select}
              label={inverse ? "Recovered file bytes" : "Encrypted file bytes"}
              source={
                inverse
                  ? "Actual verified download"
                  : "Actual ciphertext · server"
              }
              tone="cipher"
            />
          </div>
          {plain.length > 0 && cipher.length > 0 ? (
            <div className="bit-inspector">
              <div>
                <span className="eyebrow">
                  INSPECT BYTE {selected.toString().padStart(2, "0")}
                </span>
                <h3>
                  {inverse ? cipher[selected] : plain[selected]} <em>⊕</em>{" "}
                  {stream[selected]} <em>=</em>{" "}
                  {inverse ? plain[selected] : cipher[selected]}
                </h3>
                <p>
                  Select any byte above. XOR produces 1 when the two bits
                  differ, and 0 when they match.
                </p>
                <label>
                  Byte position
                  <input
                    aria-label="Byte position"
                    type="range"
                    min="0"
                    max={Math.min(plain.length, cipher.length) - 1}
                    value={selected}
                    onChange={(e) => select(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="bit-equation">
                <Bits
                  value={inverse ? cipher[selected] : plain[selected]}
                  label={inverse ? "Ciphertext" : "File byte"}
                />
                <Bits value={stream[selected]} label="Counter output" />
                <div className="bit-divider">XOR EACH BIT</div>
                <Bits
                  value={inverse ? plain[selected] : cipher[selected]}
                  label={inverse ? "Recovered byte" : "Ciphertext"}
                  tone="output"
                />
              </div>
            </div>
          ) : (
            <div className="mechanism-note">
              {op.path.endsWith("/verify")
                ? "This verification endpoint returns a verdict, not plaintext. Download the verified file to inspect its byte transformation."
                : "File bytes are shown only in the browser that selected or downloaded the file. They are excluded from exported traces."}
            </div>
          )}
          <Result
            accepted={
              accepted ? true : op.status === "rejected" ? false : undefined
            }
          >
            {encrypt.xor_verified
              ? "The backend independently calculated these first counter blocks and confirmed that file ⊕ stream equals the actual AES-GCM ciphertext output."
              : inverse && accepted
                ? "The GCM authentication check passed before the recovered bytes were returned."
                : "Waiting for the actual encryption or authentication result."}
          </Result>
          <p className="mechanism-footnote">
            The first 32 bytes are inspectable. AES round keys and intermediate
            secret round states remain private. Counter output is reconstructed
            in this browser from its own plaintext and the server ciphertext.
          </p>
        </>
      )}
      {tab === "keys" && (
        <div className="key-signature-view">
          <div className="key-wrap-line">
            <SecretBox
              title={`${key.key_bits || facts(steps, "Unwrap document key").key_bits || 256}-bit document key`}
              caption="Random secret used for this document only"
              fingerprint={key.fingerprint}
            />
            <ArrowRight />
            <div className="transform-block">
              <KeyRound />
              <b>RSA-OAEP</b>
              <span>3072-bit public key · SHA-256</span>
            </div>
            <ArrowRight />
            <ByteGrid
              hex={
                facts(steps, "Wrap the document key").wrapped_preview ||
                facts(steps, "Unwrap document key").wrapped_preview
              }
              label="Wrapped key"
              source="Actual RSA-encrypted key · preview"
            />
          </div>
          <div className="signature-line">
            <div>
              <small>SHA-256 · DOCUMENT FINGERPRINT</small>
              <code>
                {facts(steps, "Fingerprint document contents").sha256 ||
                  facts(steps, "Compare content fingerprint").sha256 ||
                  "Waiting for digest"}
              </code>
            </div>
            <ArrowRight />
            <div className="transform-block">
              <ShieldCheck />
              <b>RSA-PSS signature</b>
              <span>Private key signs · public key verifies</span>
            </div>
            <ArrowRight />
            <ByteGrid
              hex={
                facts(steps, "Sign document contents").signature_preview ||
                facts(steps, "Verify RSA-PSS signature").signature_preview
              }
              label="Digital signature"
              source="Actual signature · preview"
            />
          </div>
          <Result
            accepted={
              item(steps, "Verify RSA-PSS signature")?.facts?.verified ??
              (item(steps, "Sign document contents")?.status === "complete"
                ? true
                : undefined)
            }
          >
            {item(steps, "Verify RSA-PSS signature")
              ? "The public-key signature check compares the recovered document with its original signature."
              : "The signature binds the original document digest to the server signing identity."}
          </Result>
        </div>
      )}
      {tab === "envelope" && (
        <div className="envelope-view">
          <h3>What is actually written to storage</h3>
          <div className="envelope-strip">
            <section>
              <b>Nonce</b>
              <strong>12 bytes</strong>
              <code>{nonceHex || "—"}</code>
            </section>
            <section>
              <b>Ciphertext</b>
              <strong>
                {encrypt.ciphertext_bytes ?? read.ciphertext_bytes ?? "—"} bytes
              </strong>
              <code>{cipherHex || "—"}</code>
            </section>
            <section>
              <b>Authentication tag</b>
              <strong>16 bytes</strong>
              <code>{tag || "—"}</code>
            </section>
          </div>
          <div className="tag-workflow">
            <div>
              <small>AUTHENTICATED INPUTS</small>
              <p>Ciphertext + document/owner identity + lengths</p>
            </div>
            <ArrowRight />
            <div className="transform-block">
              <ShieldCheck />
              <b>GCM authentication</b>
              <span>Secret GHASH subkey · protected internal state</span>
            </div>
            <ArrowRight />
            <ByteGrid
              hex={tag}
              label="Actual GCM tag"
              source="Appended by AES-GCM"
            />
          </div>
          <Result
            accepted={
              item(steps, "Write encrypted envelope")?.status === "complete" ||
              item(steps, "Read encrypted envelope")?.status === "complete"
                ? true
                : undefined
            }
          >
            {facts(steps, "Write encrypted envelope").stored_bytes ||
              read.stored_bytes ||
              "—"}{" "}
            bytes in the real encrypted envelope. The wrapped key, digest and
            signature are stored as database metadata.
          </Result>
        </div>
      )}
    </div>
  );
}
function Comparison({ op, otp = false }) {
  const s = item(
      op.steps,
      otp ? "Compare one-time code" : "Compare password securely",
    ),
    f = s?.facts || {},
    signup = item(op.steps, "Hash password"),
    create = op.path === "/auth/signup" || op.path === "/auth/reset-password";
  const cost = f.bcrypt_cost || signup?.facts?.bcrypt_cost;
  return (
    <div className="mechanism-workbench credential-workbench">
      <div className="mechanism-intro">
        <span className="eyebrow">
          {otp
            ? "ONE-TIME CODE CHECK"
            : create
              ? "PASSWORD → SALTED VERIFIER"
              : "CREDENTIALS → VERIFIED IDENTITY"}
        </span>
        <h2>
          {create
            ? "Store a verifier. Keep the password out."
            : otp
              ? "Compare the code. Consume it once."
              : "Derive. Compare. Accept or reject."}
        </h2>
        <p>
          {create
            ? "The server creates a salted bcrypt verifier and commits it to the account record."
            : otp
              ? "SHA-256 hashes the submitted code, then a constant-time comparison checks it against the stored digest."
              : "The submitted password is processed using the stored bcrypt salt and cost. A constant-time comparison checks the resulting verifier."}
        </p>
      </div>
      <div className="credential-flow">
        <div className="credential-input">
          <small>{otp ? "SUBMITTED CODE" : "SUBMITTED PASSWORD"}</small>
          <strong>••••••••</strong>
          <span>The value is never copied into the visualizer</span>
        </div>
        <ArrowRight />
        <div className="bcrypt-machine">
          <Lock />
          <strong>{otp ? "SHA-256" : "bcrypt"}</strong>
          <span>
            {otp
              ? "Digest the six-digit code"
              : cost
                ? `Cost ${cost} · 2^${cost} work factor`
                : "Waiting for actual bcrypt result"}
          </span>
          <div className="work-factor-bars">
            {Array.from({ length: otp ? 0 : cost || 0 }, (_, i) => (
              <i
                className={
                  signup?.status === "complete" || s?.status === "complete"
                    ? "done"
                    : s?.status === "rejected"
                      ? "bad"
                      : ""
                }
                key={i}
              />
            ))}
          </div>
        </div>
        <ArrowRight />
        <div className="candidate-output">
          <small>
            {create
              ? "ACTUAL STORED VERIFIER FINGERPRINT"
              : "ACTUAL CANDIDATE FINGERPRINT"}
          </small>
          <code>
            {create
              ? signup?.facts?.verifier_fingerprint
              : f.candidate_fingerprint || "Waiting for comparison"}
          </code>
          <span>Protected, per-operation fingerprint</span>
        </div>
      </div>
      {!create && (
        <>
          <div
            className={
              "comparison-board " + (f.matched === false ? "mismatch" : "")
            }
          >
            <div>
              <span>CANDIDATE</span>
              <div className="fingerprint-tiles">
                {bytes(f.candidate_fingerprint).map((b, i) => (
                  <b key={i}>{b}</b>
                ))}
              </div>
            </div>
            <div className="comparison-verdict">
              <strong>
                {f.matched === true ? "=" : f.matched === false ? "≠" : "?"}
              </strong>
              <span>
                {f.matched === true
                  ? "MATCH"
                  : f.matched === false
                    ? "NO MATCH"
                    : "WAITING"}
              </span>
            </div>
            <div>
              <span>STORED</span>
              <div className="fingerprint-tiles">
                {bytes(f.stored_fingerprint).map((b, i) => (
                  <b key={i}>{b}</b>
                ))}
              </div>
            </div>
          </div>
          <Result accepted={f.matched}>
            {f.matched === true
              ? "The actual backend comparison returned true."
              : f.matched === false
                ? "The actual backend comparison returned false. Authentication stops here."
                : "Waiting for the server comparison."}
          </Result>
        </>
      )}
      <div className="credential-outcomes">
        <Gate
          title={create ? "Database commit" : "Account & session policy"}
          step={
            item(
              op.steps,
              create
                ? "Commit database transaction"
                : "Check email verification and second-factor policy",
            ) || item(op.steps, "Validate OTP challenge")
          }
          description={
            create
              ? "The verifier is committed, not the password."
              : "A matching password alone does not bypass verification or a required second factor."
          }
        />
        <Gate
          title="Email challenge"
          step={item(op.steps, "Submit security email")}
          description="The provider’s real acceptance result is recorded separately from inbox delivery."
        />
        <Gate
          title="Access token signature"
          step={item(op.steps, "Sign access token")}
          description="HS256 signs the verified session claims. Raw tokens stay private."
        />
      </div>
      <p className="mechanism-footnote">
        These paired fingerprints are derived from the real candidate and stored
        verifiers, using a fresh operation-specific mask. Raw password hashes
        and salts are not exposed.
      </p>
    </div>
  );
}
function Gate({ title, step, description }) {
  return (
    <div className={"mechanism-gate " + (step?.status || "not-reached")}>
      <span>
        {step?.status === "complete" ? (
          <Check size={18} />
        ) : step?.status === "rejected" ? (
          <X size={18} />
        ) : (
          <span className="pending-dot" />
        )}
      </span>
      <div>
        <b>{title}</b>
        <p>{description}</p>
        <small>
          {step
            ? step.status === "running"
              ? "Executing on server"
              : step.status === "complete"
                ? "Observed: completed"
                : "Observed: rejected"
            : "Not executed in this operation"}
        </small>
      </div>
    </div>
  );
}
function Policy({ op }) {
  const s = op.steps;
  const hash = facts(s, "Hash one-time credential"),
    rotation = facts(s, "Rotate session credentials"),
    logout = facts(s, "Revoke session"),
    read = s.find((x) => x.facts?.records != null);
  const recover =
    op.path.includes("forgot-password") ||
    op.path.includes("resend-verification");
  return (
    <div className="mechanism-workbench policy-workbench">
      <div className="mechanism-intro">
        <span className="eyebrow">{op.title.toUpperCase()}</span>
        <h2>
          {recover
            ? "A private recovery request."
            : op.path.includes("logout")
              ? "Revoke the session, not just the screen."
              : op.path.includes("refresh")
                ? "Replace the credentials. Retire the old session."
                : op.path.includes("verify-email")
                  ? "Prove email ownership. Consume the link."
                  : op.title}
        </h2>
      </div>
      {recover ? (
        <div className="policy-pipeline">
          <SecretBox
            title="Submitted email"
            caption="Not included in the trace"
          />
          <ArrowRight />
          <div className="transform-block">
            <Mail />
            <b>Recovery policy</b>
            <span>Account lookup and conditional delivery stay private</span>
          </div>
          <ArrowRight />
          <Result accepted={op.status === "complete" ? true : undefined}>
            Generic response returned without revealing whether an account
            exists.
          </Result>
        </div>
      ) : hash.credential_fingerprint ? (
        <div className="policy-pipeline">
          <SecretBox
            title="One-time credential"
            caption="Raw value kept out of the visualizer"
          />
          <ArrowRight />
          <div className="transform-block">
            <KeyRound />
            <b>SHA-256 lookup</b>
            <code>{hash.credential_fingerprint}</code>
            <span>Protected fingerprint of the real digest</span>
          </div>
          <ArrowRight />
          <div className="transform-block">
            <Database />
            <b>Stored record checks</b>
            <span>Purpose · expiry · unused / unrevoked</span>
          </div>
        </div>
      ) : null}
      {read && (
        <div className="record-count-view">
          <Database size={35} />
          <strong>{read.facts.records}</strong>
          <span>Actual records returned by the database query</span>
          <div className="record-tiles">
            {Array.from(
              { length: Math.min(read.facts.records, 48) },
              (_, i) => (
                <span key={i} />
              ),
            )}
          </div>
        </div>
      )}
      <div className="credential-outcomes">
        {op.path.includes("refresh") ? (
          <>
            <StateChange
              label="Previous refresh session"
              after={rotation.previous_revoked ? "REVOKED" : "Awaiting result"}
            />
            <Gate
              title="New signed access token"
              step={item(s, "Sign access token")}
              description="A new session identifier and expiry are signed."
            />
            <Gate
              title="New random refresh credential"
              step={item(s, "Generate refresh credential")}
              description="A fresh 64-byte secret replaces the old credential."
            />
          </>
        ) : op.path.includes("logout") ? (
          <StateChange
            label="Matching session record"
            after={
              logout.session_revoked
                ? "REVOKED"
                : logout.session_found === false
                  ? "NO MATCHING SESSION"
                  : "Awaiting result"
            }
          />
        ) : op.path.includes("verify-email") ? (
          <>
            <Gate
              title="Token digest, purpose and expiry"
              step={item(s, "Verify email ownership")}
              description="Only an unused, unexpired email-verification token is accepted."
            />
            <Gate
              title="Consume token and verify account"
              step={item(s, "Commit database transaction")}
              description="The successful state transition is committed atomically."
            />
          </>
        ) : op.path.includes("/2fa/") ? (
          <Gate
            title="Authentication policy update"
            step={
              item(s, "Enable email second factor") ||
              item(s, "Disable email second factor")
            }
            description="The authenticated account’s policy is changed and committed."
          />
        ) : op.path.includes("/audit/") ? (
          <Gate
            title="HMAC chain verification"
            step={item(s, "Verify activity chain")}
            description="Each stored digest is recomputed using the real secret key and previous link."
          />
        ) : op.path.includes("/documents/") &&
          op.path.includes("DELETE") ? null : (
          <Gate
            title="Active-session authorization"
            step={item(s, "Authorize active session")}
            description="JWT signature, session revocation, expiry and account policy are checked."
          />
        )}
      </div>
      {op.path.startsWith("/vault/documents/") &&
        item(s, "Remove encrypted bytes") && (
          <>
            <div className="policy-pipeline">
              <div className="transform-block">
                <FileText />
                <b>Document record</b>
                <span>Owned by the authenticated account</span>
              </div>
              <ArrowRight />
              <Gate
                title="Commit metadata deletion"
                step={item(s, "Commit database transaction")}
                description="The database row is removed."
              />
              <ArrowRight />
              <Gate
                title="Remove encrypted file"
                step={item(s, "Remove encrypted bytes")}
                description="The physical encrypted envelope is deleted."
              />
            </div>
          </>
        )}
      <Result
        accepted={
          op.status === "complete"
            ? true
            : op.status === "rejected"
              ? false
              : undefined
        }
      >
        {op.status === "complete"
          ? `The server completed this operation with HTTP ${op.http}.`
          : op.status === "rejected"
            ? `The server rejected this operation with HTTP ${op.http}.`
            : "Waiting for actual server results."}
      </Result>
    </div>
  );
}
function StateChange({ label, after }) {
  return (
    <div className="state-change">
      <span>{label}</span>
      <div>
        <b>Before request</b>
        <ArrowRight />
        <strong>{after}</strong>
      </div>
    </div>
  );
}
export default function TransformationView({ op, operations }) {
  if (
    op?.status === "rejected" &&
    !op.steps.some(
      (s) =>
        s.category === "crypto" ||
        s.name === "Compare password securely" ||
        s.name === "Compare one-time code",
    )
  )
    return (
      <div className="mechanism-workbench">
        <div className="mechanism-intro">
          <span className="eyebrow">REQUEST REJECTED</span>
          <h2>The cryptographic operation was not reached.</h2>
          <p>
            The server rejected validation or access policy with HTTP {op.http}.
            No encryption, signing or credential transformation is shown as
            completed.
          </p>
        </div>
        <Result accepted={false}>
          The operation stopped at the server’s validation or authorization
          boundary.
        </Result>
      </div>
    );

  if (!op)
    return (
      <div className="mechanism-empty">
        <FileText />
        <h2>Perform an action to inspect its actual transformation.</h2>
      </div>
    );
  if (
    (op.path === "/vault/documents" && op.title === "Encrypt document") ||
    op.path.endsWith("/download") ||
    op.path.match(/\/documents\/[^/]+\/verify$/)
  )
    return <Encryption op={op} operations={operations} />;
  if (
    [
      "/auth/login",
      "/auth/signup",
      "/auth/reset-password",
      "/auth/verify-otp",
    ].includes(op.path)
  )
    return <Comparison op={op} otp={op.path === "/auth/verify-otp"} />;
  return <Policy op={op} />;
}
