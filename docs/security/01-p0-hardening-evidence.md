# Phase 1 → P0 Hardening Evidence

**Date:** 2026-11-05  
**Scope:** Critical findings C-01, C-02, C-03, H-01 (partial), H-02 (infra bind), H-03 (OTP pepper)

## Changes

| Finding | Fix | Files |
|---|---|---|
| C-01 Rate limits no-op | Restored Redis incr/block for API + auth | `security-rate-limit.service.ts`, `auth-rate-limit.service.ts`, `main.ts` (no longer clears keys on boot) |
| C-02 JWT not session-bound | `JwtStrategy.validate` checks Redis session; WS connect + `requireUserId` same | `jwt.strategy.ts`, `messaging.gateway.ts`, `auth-session.service.ts`, `auth.module.ts`, `messaging.module.ts` |
| C-03 Refresh reuse | Valid hash of revoked refresh → `revokeAllSessionsForUser` | `auth.service.ts` |
| H-01 local-file by mediaId | Hybrid reads mint/validate Redis `media:read-token:*`; private requires token | `media.storage.ts`, `media.service.ts` |
| H-02 Docker exposure | Postgres/Redis ports bound to `127.0.0.1`; optional Redis password | `docker-compose.yml` |
| H-03 OTP pepper | Removed `'otp-pepper'` literal; require OTP_PEPPER or JWT secret | `account-settings.service.ts`, `phone-auth.service.ts`, `app-config.service.ts`, `env.validation.ts`, `.env.example` |

## Docs added

- `docs/security/00-security-audit-report.md`
- `docs/security/security-architecture.md`
- `docs/security/security-operations-runbook.md`
- `docs/security/production-security-checklist.md`
- `docs/security/incident-response-plan.md`

## Verification

Run (with Redis + backend env available):

```bash
cd backend
npx tsc -p tsconfig.build.json --noEmit
node ../scripts/security-p0-smoke.mjs
```

### Expected smoke results

| Check | Expected |
|---|---|
| Auth rate limit after N failures | HTTP 429 path via Redis block key |
| Session delete → JWT validate | Unauthorized / session expired |
| Private local-file without token | 403 |
| Private local-file with Redis token | 200 (when file exists) |

## Residual risk (not closed)

- MFA TOTP not yet implemented (M-02).
- Argon2id migration pending (M-01).
- Magic-byte upload validation pending (M-04).
- JWT `iss`/`aud` pending (M-03).
- Full authorization regression suite pending (Phase 3).
- Production Redis AUTH only if `REDIS_PASSWORD` set (ops).
- Publicish media (`avatar`/`cover`) still readable without token by design.

**Verdict:** P0 Critical auth/rate/media path hardened in code. System is **not** “fully secure”; continue Phases 2–20.
