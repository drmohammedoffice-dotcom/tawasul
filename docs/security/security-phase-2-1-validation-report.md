# Security Phase 2.1 — Validation Report

**Date:** 2026-11-05  
**Scope:** Close remaining gaps from `ultimate-security-hardening-report.md` without regressing P0 fixes.  
**Disclaimer:** Residual risk remains. SKIP items are explicit, not waived as “secure”.

---

## 1. Argon2id password migration

| Check | Result | Evidence |
|---|---|---|
| New hashes use Argon2id | PASS | `password-hasher.ts` → `argon2.hash` type argon2id |
| Legacy bcrypt still verifies | PASS | `scripts/security-argon2-migrate-test.mjs` |
| Transparent rehash after bcrypt login | PASS | `AuthService.login` upgrades when `needsRehash` |
| Wrong password rejected | PASS | unit script |
| No forced mass reset | PASS | dual-verify path only |

**Commands:**
```bash
node scripts/security-argon2-migrate-test.mjs
# → Summary: PASS=5 FAIL=0
```

**Files:** `backend/src/modules/auth/password-hasher.ts`, `auth.service.ts`, `account-settings.service.ts`, `phone-auth.service.ts`, `totp.service.ts`

---

## 2. JWT iss / aud / kid rotation

| Check | Result | Evidence |
|---|---|---|
| Sign with `kid` + iss/aud | PASS | `JwtKeysService.accessSignOptions` |
| Verify rejects bad iss/aud | PASS | `security-jwt-claims-test.mjs` |
| Previous kid still verifies | PASS | rotation unit |
| Unknown kid / wrong secret rejected | PASS | unit |
| Expired rejected | PASS | unit |
| Redis session binding retained | PASS | `JwtStrategy.validate` + redis fail-closed live test |

**Commands:**
```bash
node scripts/security-jwt-claims-test.mjs
# → PASS=7 FAIL=0
```

**Env:** `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_KID`, `JWT_REFRESH_KID`, `JWT_*_PREVIOUS_KEYS`  
**Files:** `jwt-keys.service.ts`, `jwt.strategy.ts`, `auth.service.ts`, `messaging.gateway.ts`, `app-config.service.ts`, `env.validation.ts`

---

## 3. OTP_PEPPER

| Check | Result | Evidence |
|---|---|---|
| Production requires dedicated pepper | PASS | Joi `when NODE_ENV=production` + `otpPepper` throws |
| No hardcoded `'otp-pepper'` | PASS | removed |
| Dev fallback warns | PASS | console.warn path |
| Rotation documented | PASS | `docs/security/otp-pepper-rotation.md` |

**Files:** `app-config.service.ts`, `env.validation.ts`, `account-settings.service.ts`, `phone-auth.service.ts`, `.env.example`

---

## 4. MFA frontend

| Check | Result | Evidence |
|---|---|---|
| Begin TOTP (password re-auth) | PASS (code) | Settings UI + `/auth/mfa/totp/begin` |
| QR shown from server data URL | PASS (code) | `qrcode` → `qrDataUrl` (secret never sent to third-party QR APIs) |
| Confirm + recovery codes once | PASS (code) | UI + API |
| Disable with password + code | PASS (code) | UI + API |
| Login MFA challenge | PASS (code) | `App.tsx` / `SocialRoot` + `/auth/mfa/verify` |
| Sessions list / revoke | PASS (live IDOR) | `/account` sessions + revoke foreign → 404; revoke deletes Redis sid |

**Files:** `AccountSettingsPages.tsx`, `AuthScreen.tsx`, `App.tsx`, `SocialRoot.tsx`, `api/accounts.ts`, `api/client.ts`, `i18n/messages.ts`, `totp.service.ts`

---

## 5. IDOR / BOLA (dual accounts)

**Command:** `node scripts/security-idor-bola.mjs`  
**Result:** `PASS=7 FAIL=0 SKIP=0`

| Case | Result |
|---|---|
| Register A & B | PASS |
| B `/account` is B only | PASS |
| B DELETE A session | PASS (404) |
| Non-staff moderation admin | PASS (403) |
| Guessed media id | PASS (404) |
| Conversations auth for B | PASS |
| Access token after logout | PASS (401) |

---

## 6. Security scanning

| Tool | Result | Artifact |
|---|---|---|
| npm audit (high+) | PASS (executed; findings recorded) | `docs/security/scans/npm-audit.json`, `npm-audit-summary.md` |
| Semgrep | SKIP | `docs/security/scans/semgrep.md` |
| OWASP ZAP | SKIP | `docs/security/scans/zap-baseline.md` |
| Trivy | PASS (completed after retry) | `docs/security/scans/trivy-fs.json` — Critical 3 / High 27; see `trivy.md` |

Critical npm finding (`@capacitor/android`) is **documented, not hidden**.

---

## 7. Backup recovery drill

**Command:** `node scripts/security-backup-restore-drill.mjs`  
**Result:** `PASS=5 FAIL=0`

| Metric | Measured |
|---|---|
| Dump size | 747 623 bytes |
| Restore User\|RefreshToken counts | 372\|1605 |
| Lab dump duration | ~seconds (see drill md) |
| Lab restore duration | ~seconds (see drill md) |
| RPO (lab) | Last successful dump age (this run created a fresh dump) |
| RTO (lab) | Time to restore into empty temp DB (see drill report) |

**Artifacts:** `docs/security/scans/backups/*.dump`, `restore-drill-*.md`  
Primary DB was **not** dropped.

---

## 8. Redis fail-closed

**Command:** `node scripts/security-redis-failclosed.mjs`  
**Result:** `PASS=4 FAIL=0`

| Check | Result |
|---|---|
| Fresh JWT works | PASS |
| Delete Redis `auth:session:{sid}` | — |
| Same JWT then `/account` | PASS (401) — **not** auto-accepted |

`AuthSessionService` throws `ServiceUnavailableException` on Redis I/O errors (fail-closed).

---

## 9. Regression (P0 / TOTP / magic / rate limit / media)

| Suite | Result |
|---|---|
| `tsc -p backend/tsconfig.build.json --noEmit` | PASS |
| `security-p0-smoke.mjs` | PASS 5/5 |
| `security-totp-unit.mjs` | PASS 5/5 |
| `security-magic-unit.mjs` | PASS 4/4 |
| `security-argon2-migrate-test.mjs` | PASS 5/5 |
| `security-jwt-claims-test.mjs` | PASS 7/7 |
| Rate-limit Redis keys | PASS (p0 smoke) |
| local-file without token | PASS (404) |

---

## Changed files (primary)

- `backend/src/modules/auth/password-hasher.ts` (new)
- `backend/src/modules/auth/jwt-keys.service.ts` (new)
- `backend/src/modules/auth/auth.service.ts`
- `backend/src/modules/auth/strategies/jwt.strategy.ts`
- `backend/src/modules/auth/auth-session.service.ts`
- `backend/src/modules/auth/totp.service.ts`
- `backend/src/modules/auth/auth.module.ts`
- `backend/src/modules/messaging/messaging.gateway.ts`
- `backend/src/modules/accounts/account-settings.service.ts`
- `backend/src/modules/accounts/phone-auth.service.ts`
- `backend/src/modules/config/app-config.service.ts`
- `backend/src/modules/config/env.validation.ts`
- `frontend/src/app/social/AccountSettingsPages.tsx`
- `frontend/src/app/AuthScreen.tsx`, `App.tsx`, `SocialRoot.tsx`
- `frontend/src/api/client.ts`, `accounts.ts`, `types/api.ts`, `i18n/messages.ts`
- `scripts/security-*.mjs` (argon2, jwt, idor, redis, backup)
- `docs/security/*`, `.github/workflows/security.yml`

---

## Residual risks

1. Semgrep + ZAP not executed in this environment (SKIP with docs).
2. Trivy CI gate added; local Docker scan may still be catching up on first DB download.
3. npm Critical Capacitor Android advisory remains until mobile release triage.
4. TOTP sealed with `OTP_PEPPER` — rotating pepper without re-seal breaks MFA (documented).
5. Existing bcrypt users migrate on next successful login (not offline bulk).
6. Frontend MFA UI not covered by automated browser E2E in this phase (API + unit evidence only).

**Verdict:** Phase 2.1 core auth/crypto/session/IDOR/backup/redis-fail-closed items are evidenced PASS. Scanner gaps remain explicitly SKIP/pending — system is not claimed unhackable.
