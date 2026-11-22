# Vellum

A private document workspace built with Next.js, FastAPI and PostgreSQL.

```powershell
docker compose up --build -d --wait
```

Open http://localhost:3080. One container (`vellum`) runs the interface, API and database. The named volume retains documents, cryptographic keys and account records.

The local `.env` configures Brevo. Credentials are excluded from Git and the image. A verified account is created for `DEMO_EMAIL` (falling back to `MAIL_FROM`), with password `VellumDemo1!`. Without email configuration, the local account is `demo@vellum.app`.

Files use AES-256-GCM with individual random keys, RSA-3072 OAEP key wrapping and RSA-PSS signatures. Server-managed keys protect stored files; this is not end-to-end encryption. Local access binds to loopback and uses HTTP.

The executable checks are in `checks/`. Browser checks: `cd web; npm ci; npx playwright install chromium; npx playwright test`. Existing run evidence is in `evidence/`.
