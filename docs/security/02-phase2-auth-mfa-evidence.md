# Phase 2 — Identity & Authentication Evidence

**Date:** 2026-11-05

## Implemented

| Requirement | Status | Evidence |
|---|---|---|
| Password policy (length, common list, username/email) | Done | `password-policy.ts`; used in register + changePassword |
| No cleartext passwords / no OTP pepper literal | Done | bcryptjs cost 12; OTP pepper requires env |
| Change password revokes all sessions | Done | `account-settings.service.ts` → `revokeAllSessionsForUser` |
| Refresh reuse kills family | Done (P0) | `auth.service.ts` |
| Access JWT session-bound | Done (P0) | `jwt.strategy.ts` + WS |
| TOTP MFA (authenticator) | Done | `totp.service.ts`, sealed secret AES-GCM, recovery codes hashed |
| Re-auth for enable/disable TOTP | Done | password required on begin/disable |
| Audit on MFA enable/disable | Done | `auth.totp.*` audit actions |
| Argon2id | Deferred | bcryptjs kept; dual-verify migration planned later |

## API surface

- `POST /api/auth/login` → may return `{ requiresMfa, mfaToken }`
- `POST /api/auth/mfa/verify` → completes login with TOTP/recovery code
- `GET /api/auth/mfa/totp/status`
- `POST /api/auth/mfa/totp/begin` (password)
- `POST /api/auth/mfa/totp/confirm` (code → recovery codes once)
- `POST /api/auth/mfa/totp/disable` (password + code)

## Schema

`User.totpSecretEnc`, `User.totpEnabledAt`, `User.totpRecoveryHashes` — applied via `prisma db push`.

## Residual

- Frontend MFA challenge UI not yet wired (API-ready).
- Argon2id migration not started.
- JWT `iss`/`aud` still pending.
- Admin forced-MFA policy is ops/checklist (not automatic yet).
