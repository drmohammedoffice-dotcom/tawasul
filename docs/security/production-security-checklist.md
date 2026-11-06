# Production Security Checklist — SecureChat / تواصل

Use before every production deploy. Items marked **APP** are enforced in code; **OPS** require infrastructure/config outside the app.

## Identity & sessions

- [ ] **APP** Access JWT bound to live Redis session (`JwtStrategy` + WS connect).
- [ ] **APP** Refresh rotation + reuse detection kills all user sessions.
- [ ] **APP** Login rate limits active (`AuthRateLimitService`).
- [ ] **OPS** `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 random chars; distinct.
- [ ] **OPS** Set dedicated `OTP_PEPPER` (≥ 16 chars); do not reuse weak defaults.
- [ ] **OPS** Access TTL short (e.g. 15m); refresh ≤ 7d.
- [ ] **OPS** `AUTH_COOKIE_SECURE=true`, `SameSite=lax|strict`, HTTPS only.

## API & transport

- [ ] **OPS** TLS 1.2+ terminated at reverse proxy / Cloudflare.
- [ ] **OPS** `CLIENT_ORIGINS` / `WS_ALLOWED_ORIGINS` exact allowlist (no `*`).
- [ ] **APP** Helmet + ValidationPipe whitelist enabled.
- [ ] **APP** API/WS/media rate limits active (`SecurityRateLimitService`).
- [ ] **OPS** Debug / Swagger / stack traces disabled in production.

## Data stores

- [ ] **OPS** Postgres not published to the internet (compose binds `127.0.0.1` by default).
- [ ] **OPS** Redis not published to the internet; set `REDIS_PASSWORD` and update `REDIS_URL`.
- [ ] **OPS** App DB role is not superuser; least privilege.
- [ ] **OPS** Encrypted backups with tested restore (RPO/RTO documented).

## Media

- [ ] **OPS** R2/S3 keys only in server env — never in frontend.
- [ ] **APP** Private `local-file` reads require Redis capability tokens.
- [ ] **OPS** Bucket policies deny public listing; signed URLs short TTL.

## Admin

- [ ] **OPS** Admin accounts use strong unique passwords + MFA when available.
- [ ] **APP** Admin APIs behind role guards (re-verify in Phase 3 tests).
- [ ] **OPS** Audit log sink retained and immutable to operators.

## Supply chain & deploy

- [ ] **OPS** `npm audit` / dependency scan gate for Critical/High.
- [ ] **OPS** Secret scanning in CI; `.env` never committed.
- [ ] **OPS** Container images pinned; non-root where possible.
- [ ] **OPS** Staging cannot reach production data.

## Monitoring & IR

- [ ] **OPS** Alerts for auth lockouts, 401 spikes, admin role changes.
- [ ] **OPS** Incident response plan reviewed (`incident-response-plan.md`).
- [ ] **OPS** Session revoke runbook practiced once per quarter.
