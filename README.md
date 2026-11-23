# Vellum

A private document workspace built with Next.js, FastAPI and PostgreSQL.

```powershell
docker compose up --build -d --wait
```

Open http://localhost:3080. One container (`vellum`) runs the interface, API and database. The named volume retains documents, cryptographic keys and account records.

The local `.env` configures Brevo. Credentials are excluded from Git and the image. A verified account is created for `DEMO_EMAIL` (falling back to `MAIL_FROM`), with password `VellumDemo1!`. Without email configuration, the local account is `demo@vellum.app`.

Files use AES-256-GCM with individual random keys, RSA-3072 OAEP key wrapping and RSA-PSS signatures. Server-managed keys protect stored files; this is not end-to-end encryption. Local access binds to loopback and uses HTTP.

The executable checks are in `checks/`. Browser checks: `cd web; npm ci; npx playwright install chromium; npx playwright test`. Existing run evidence is in `evidence/`.

Actions open the transformation studio. Select actual file bytes to inspect AES-GCM's counter/XOR calculation in hex and bits, view wrapped-key and signature outputs, or inspect the stored envelope. Login displays protected fingerprints derived from the actual candidate and stored verifiers. Background reads remain available in the operation selector.

The process view uses a capability-protected server event stream, with bounded five-minute server retention. It shows real function calls and measured outputs, not invented cipher rounds. Passwords, OTPs, raw credentials and private keys are excluded. Recovery flows suppress account-specific details.
