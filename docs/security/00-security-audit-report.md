# SecureChat / تواصل — Security Audit Report (Phase 1)

**Date:** 2026-11-05  
**Scope:** Current codebase under `c:\xampp\htdocs\تواصل` (backend NestJS, frontend React/Vite, Docker, media, WebSocket, moderation).  
**Method:** Code review of live sources against OWASP ASVS / API Top 10. No assumption that docs match reality.  
**Disclaimer:** No system is unhackable. This report ranks residual risk and prioritized remediations.

---

## 1. Asset inventory

| Asset | Location / tech | Sensitivity | Exposure |
|---|---|---|---|
| User accounts | PostgreSQL `User` (passwordHash, email, phone, role) | Critical | API |
| Sessions / refresh tokens | Redis `auth:session:*` + Prisma `RefreshToken` (hashed) | Critical | API |
| JWT secrets | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` in env | Critical | Server only (if .env not leaked) |
| Direct messages | Messaging services + WS gateway | Critical | API + WS |
| Media objects | Local `MEDIA_LOCAL_BASE_PATH` + Cloudflare R2 | High | `/api/media/local-file`, signed R2 URLs |
| OTP challenges | Prisma `EmailOtpChallenge` (hashed), peppered | High | API |
| Admin / moderation | Role `admin`/`moderator` + moderation RBAC | High | Admin APIs |
| Redis | docker-compose port 6379 | High | Host network (dev) |
| PostgreSQL | docker-compose port 5432 | Critical | Host network (dev) |
| AI service | local `ai-service` | Medium | Internal |
| Frontend SPA | Vite `:5173` | Low (must not be trust boundary) | Public |

**Trust boundaries:** Browser → API/WS; API → Postgres/Redis/R2; API → AI service; Admin role → moderation actions.

---

## 2. Strengths already present

- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` (`backend/src/main.ts`).
- Helmet enabled; CORS origin allowlist (not `*` with credentials).
- Passwords hashed with bcryptjs cost 12; refresh tokens stored as bcrypt hashes.
- Refresh tokens rotated on use (old row `revokedAt`).
- Most REST controllers use `JwtAuthGuard`.
- WebSocket connects require JWT access token + origin check (`messaging.gateway.ts`).
- Moderation auto-scan refuses `message` target type and skips chat/message media purposes.
- Content access gate + public moderation quarantine for posts/reels.
- `.env` listed in `.gitignore`.

---

## 3. Findings (ordered by severity)

### C-01 — Application rate limiting disabled (Critical)

**Evidence:** `backend/src/modules/security/security-rate-limit.service.ts` — `assertIpAllowed` / `consumeLimit` are intentional no-ops.  
`backend/src/modules/auth/auth-rate-limit.service.ts` — login assert/record also no-ops.  
`main.ts` calls `clearAllLimits()` on every boot.

**Impact:** Brute force, credential stuffing, WS flood, media scrape, and API abuse are unconstrained despite call sites existing.

**OWASP:** API4 / A07. **CVSS-like:** 8.6 (network, low complexity, no auth for login).

---

### C-02 — Access JWT not bound to live session (High)

**Evidence:** `jwt.strategy.ts` only checks `payload.type === 'access'`. Logout deletes Redis session + revokes refresh, but access JWT remains valid until expiry.

**Impact:** Stolen/leaked access tokens work after logout / password change until TTL ends. WS also verifies JWT signature only.

**OWASP:** A07.

---

### C-03 — Refresh-token reuse does not kill session family (High)

**Evidence:** `auth.service.ts` `refreshToken()` — if `record.revokedAt`, throws `invalid refresh token` without revoking sibling sessions for that user/device chain.

**Impact:** Attacker who captured an old refresh token can detect rotation failures without forced global logout of the victim.

**OWASP:** A07 / ASVS V3.

---

### H-01 — Hybrid `local-file` can serve by mediaId when file is on disk (High)

**Evidence:** `media.service.ts` `resolveLocalFileRequest` — for non-local driver, if `safeLocalAbsolutePath(storageKey)` exists, streams file without Redis token validation / without JWT.

**Impact:** Knowledge of a media UUID (logs, referrer, XSS, shared URL) can fetch private post/avatar bytes if a local mirror exists (common after NSFW `ensureLocalFile`).

**OWASP:** API1 / A01.

---

### H-02 — Docker Compose publishes Postgres & Redis (High for production)

**Evidence:** root `docker-compose.yml` maps `5432:5432` and `6379:6379` with Redis `redis-server` **without** `--requirepass`.

**Impact:** On a non-isolated host/network, DB/cache are reachable; default passwords in compose defaults amplify risk.

**OWASP:** A02 / A05.

---

### H-03 — OTP pepper fallback insecure (High)

**Evidence:** `account-settings.service.ts` / `phone-auth.service.ts` — `pepper()` returns `JWT_ACCESS_SECRET` or literal `'otp-pepper'`.

**Impact:** OTP hashes coupled to JWT secret; missing env → static pepper.

---

### M-01 — Password hashing is bcryptjs, not Argon2id (Medium)

**Evidence:** `auth.service.ts` imports `bcryptjs`. Acceptable if cost ≥12, but ASVS prefers Argon2id / scrypt.

---

### M-02 — No TOTP MFA; email OTP only (Medium)

**Evidence:** Account settings use email OTP for “2FA”, not authenticator TOTP + recovery codes.

---

### M-03 — JWT lacks explicit `iss` / `aud` / algorithm allowlist (Medium)

**Evidence:** `signAsync` / `verifyAsync` use secret only; no `issuer`/`audience`; Passport default alg handling.

---

### M-04 — No magic-byte validation on uploads (Medium)

**Evidence:** Media stack trusts declared MIME / size / uploader ownership; no `file-type` / signature sniff in `media.service.ts`.

---

### M-05 — Global presence broadcast (Medium / privacy)

**Evidence:** `messaging.gateway.ts` — `this.server.emit('presence:updated', data)` to all connected clients.

---

### M-06 — CORS allows missing Origin (Medium)

**Evidence:** `main.ts` — `if (!origin) callback(null, true)`.

**Note:** Needed for non-browser clients; ensure cookies + CSRF posture stay consistent.

---

### L-01 — Nest clears all rate keys on startup (Low once limits re-enabled)

**Evidence:** `main.ts` → `clearAllLimits()`.

---

### I-01 — Info: DMs not auto-scanned (positive)

Moderation enqueue rejects `message` reports via auto path; pack filters `purpose` message/chat.

---

## 4. Attack surface map (summary)

```
[Browser/SPA] --HTTPS/WS--> [Nest API :3000]
                               |-- JWT (access, short)
                               |-- Cookie refreshToken (httpOnly)
                               |-- /api/media/local-file/:id (often unauthenticated)
                               |-- WebSocket /realtime
                               +--> Postgres (:5432 exposed in compose)
                               +--> Redis (:6379 exposed, no auth in compose)
                               +--> R2 (signed URLs)
                               +--> ai-service (internal)
```

---

## 5. Execution plan (severity-ordered)

| Priority | Phase | Work item | Status |
|---|---|---|---|
| P0 | 4/14 | Restore Redis rate limits (API + auth + WS) | Done (2026-11-05) |
| P0 | 2 | Bind access JWT to Redis session; invalidate on logout | Done |
| P0 | 2 | Refresh-token reuse → revoke all user sessions | Done |
| P0 | 9 | Require capability token / JWT for private local-file reads | Done (publicish excepted) |
| P1 | 11 | Harden compose: no public DB/Redis; Redis AUTH; non-root | Partial (loopback + optional AUTH) |
| P1 | 2 | Dedicated OTP pepper; remove `'otp-pepper'` fallback | Done |
| P1 | 2 | Argon2id migration path (dual-verify) | Planned |
| P1 | 2 | TOTP MFA + recovery codes | Planned |
| P1 | 3 | Central RolesGuard + ownership regression tests | Planned |
| P2 | 5/9 | Magic-byte allowlist; SSRF guard utility | Planned |
| P2 | 6 | Presence room scoping; WS session re-check | Planned |
| P2 | 13–18 | Security logging, IR docs, CI gates, ZAP in lab | Planned |

---

## 6. Phase 1 gate

- [x] Inventory completed from live code  
- [x] Critical/High findings documented with evidence  
- [x] Ranked remediation plan  
- [x] Critical P0 items remediated (see `01-p0-hardening-evidence.md`)

**Next:** Phase 2 remainder (Argon2id path, TOTP MFA, JWT iss/aud) + Phase 3 authorization regression tests.
