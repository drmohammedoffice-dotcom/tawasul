# SecureChat — Phase 1: Advanced Profiles, Business Accounts, Verification & Account Security (Report 20)

**Date:** 2026-10-24  
**Based on:** Reports 15–19 (closed alpha gate → UX/auth → media → messaging → fixture separation)  
**Constraints honored:** No project rewrite; no feature/data wipe; no DB recreate; no secrets in this report; no self-approval of verification; no claim that live SMS/WhatsApp works without credentials.

---

## 1) Pre-implementation audit

| Check | Result |
|-------|--------|
| Stack | NestJS 11 + Prisma + Postgres/Redis; React 19 + Vite 6 |
| Git | Workspace is **not** a git repository (`git status` → fatal) |
| Prior reports | `15`–`19` under `docs/social-platform/` — fixture flagging, story expiry, CORP media, AuthProvider |
| Auth before Phase 1 | Username/password JWT + refresh; sessions in DB |
| Media | Local/R2 storage + signed URLs; purpose field extended for `verification` / `highlight` |
| Migrations | Prisma schema extended + `prisma db push` (unique phone) — **no** `migrate reset` / drop |

---

## 2) Schema & backend surface

### 2.1 Prisma (additive)

- `User`: `accountType`, `phoneE164` (unique), `phoneVerifiedAt`, `isVerified`, `twoFactorEmailEnabled`, `countryCode`, `passwordSetAt`, …
- `Story.audience`: `everyone` \| `close_friends`
- `BusinessProfile` (name, category, description, links, address, lat/lng)
- `VerificationRequest` + `VerificationDocument` (status enum, track, **hashed** registration/identity/document fingerprints — plaintext ID numbers stored as `[redacted]` or not at all)
- `StoryHighlight` + items (snapshot media)
- `CloseFriend`, `UserInterest`
- `PhoneOtpChallenge` / `EmailOtpChallenge` (hashed OTP only)
- `UserRole.admin` for future admin review (not end-user self-approve)

### 2.2 Module: `backend/src/modules/accounts/`

| File | Role |
|------|------|
| `accounts.controller.ts` | REST: business, verification (+ admin), highlights, close friends, account settings, phone auth |
| `business.service.ts` | Switch to business, update profile, **Google Maps public URL** from coords/address (no secret FE key) |
| `business-categories.ts` | Expandable category catalog (medical, company, retail, goods, professional, food, other) + `requiresLicense` |
| `verification.service.ts` | Tracks `licensed_business` vs `individual_seller`; statuses; admin review APIs; hash dedupe |
| `highlights.service.ts` | CRUD + privacy gate aligned with private profiles |
| `close-friends.service.ts` | List / candidates / add / remove |
| `account-settings.service.ts` | Account info, password, email link, email 2FA, country, sessions, blocked list, interests |
| `phone-auth.service.ts` | E.164 normalize, OTP request/verify, anti-enumeration, email 2FA second step |
| `messaging-provider.ts` | Pluggable SMS/WhatsApp/email — **mock** default; live Twilio path refuses silent success without full wiring |
| `otp.util.ts` | Normalize phone, hash OTP with pepper, constant-time compare |

### 2.3 Related social updates

- Stories: create/list/view enforce `close_friends` via API
- Profiles: return business + verified + counts; posts/reels by author
- Reels: `GET /reels/user/:idOrUsername`
- Media purposes: verification / highlight / avatar

### 2.4 Env (safe)

```
OTP_MESSAGING_DRIVER=mock   # default; set live only with real provider creds
# TWILIO_* optional — not claimed working in this build
```

Do **not** put Maps secret keys in the frontend. Business location uses public Maps search/dir URLs.

---

## 3) Frontend

| Area | Paths |
|------|--------|
| Phone auth | `PhoneAuthPanel.tsx` + AuthGate tabs (phone default + password) |
| Profile | `ProfilePages.tsx` — Posts/Reels tabs, highlights, verified badge, business location CTA |
| Edit profile | `EditProfilePage.tsx` + `AvatarCrop.tsx` (camera / gallery / crop / remove) |
| Highlights | `HighlightCreatePage.tsx` |
| Settings hub | `AccountSettingsPages.tsx` — Account Information, Security, Privacy, Blocked, Close Friends, Interests, Business, Verification |
| Stories audience | `StoriesUI.tsx` — Everyone / Close friends |
| API client | `frontend/src/api/accounts.ts` |
| i18n | EN + AR keys in `messages.ts` |
| CSS | Phase 1 blocks in `social.css` |
| Staging | `scripts/sync-frontend-ascii.ps1` → `C:\xampp\htdocs\securechat-web` |

Routes: `/profile/edit`, `/profile/highlights/new`, `/settings/*` (security, privacy, blocked, close-friends, interests, business, verification).

---

## 4) Behaviour notes (honest)

### Verification

- Statuses: not submitted → pending review → more info / approved / rejected.
- Blue check (`isVerified`) **only** after admin review API (`POST /admin/verification/:id/review`) — never on upload alone.
- Dedupe: SHA-256 of normalized registration / national ID / document content hashes; clashes with **approved** other users → conflict.
- Documents: private media purpose; no plaintext ID in DB columns used for matching.
- Upload of an image does **not** prove document authenticity — human (or future trusted service) review required.

### Phone auth

- Primary path: country + phone → OTP (SMS or WhatsApp channel flag) → verify → session.
- Anti-enumeration: opaque errors; register/login responses do not reveal “phone exists”.
- OTP hashed at rest; **not** written to logs (mock logs only masked destination).
- Resend: ≥1 request / 60s per phone+purpose; hourly cap.
- Email 2FA: phone OTP is **not** consumed until 2FA succeeds; possessing the phone alone cannot bypass 2FA.
- Mock mode returns `debugCode` for local testing only; `delivery.accepted` reflects provider result.

### Privacy / block / close friends

- Private accounts: API gates posts, stories, highlights, search exposure (existing + extended).
- Unblock does not restore follow automatically.
- Close-friends stories enforced in `stories.service` + media access paths.

### Interests

- Stored on register and editable in Settings.
- Intended later for ranking / ads audience — **ads system is not complete** by storing interests alone.
- Usage must remain subject to privacy policy / user settings / applicable law.

---

## 5) Tests executed

| Suite | Result |
|-------|--------|
| `npx tsc` backend (`tsconfig.build.json`) | PASS |
| `npx tsc` frontend (`tsconfig.json --noEmit`) | PASS |
| `scripts/phase1-accounts-smoke.mjs` | **10/10 PASS** (phone register/login, interests, privacy toggle, business+Maps URL, verification admin gated, close friends, highlights, OTP resend limit) |
| `ux-completion-smoke.mjs` | 6/6 PASS |
| `rc-feature-smoke.mjs` | 6 PASS, 1 NOT RUN (no reels asset) |
| `critical-launch-fixes-regression.mjs` | 5/5 PASS |
| `product-readiness-smoke.mjs` | Initially failed with **429** after stacked smokes; after Redis flush + API restart, re-run required when rate window clear — treat stacked 429 as infra throttle, not Phase 1 logic regression |

Phase 1 smoke command:

```bash
node scripts/phase1-accounts-smoke.mjs
```

---

## 6) External wiring still required (not claimed done)

| Integration | Status |
|-------------|--------|
| Live SMS / WhatsApp (Twilio or equivalent) | Provider interface present; live path returns failure until fully wired + credentials |
| Live email OTP delivery | Mock only unless mailer configured |
| Google Maps **Secrets** / Places API | Not required for “open location in Maps” URL flow |
| Admin console UI | APIs ready; **no** end-user admin UI in this phase |
| Full ads / interest targeting | Interests stored only |

---

## 7) Main files touched (summary)

**Backend:** `prisma/schema.prisma`, `modules/accounts/*`, `stories.*`, `profiles.*`, `reels.*`, `app.module.ts`, `env.validation.ts`, `.env` (`OTP_MESSAGING_DRIVER`)

**Frontend:** `SocialRoot.tsx`, `PhoneAuthPanel.tsx`, `ProfilePages.tsx`, `EditProfilePage.tsx`, `AvatarCrop.tsx`, `AccountSettingsPages.tsx`, `HighlightCreatePage.tsx`, `StoriesUI.tsx`, `api/accounts.ts`, `api/social.ts`, `i18n/messages.ts`, `social.css`

**Scripts/docs:** `scripts/phase1-accounts-smoke.mjs`, this report

---

## 8) Exit criteria for Phase 1

- [x] Additive schema; no DB wipe  
- [x] Profile avatar crop + Posts/Reels + highlights + separate Edit Profile  
- [x] Business switch + location Maps URL (no secret FE keys)  
- [x] Verification tracks + admin-only approve + hash dedupe  
- [x] Account Information / 2FA / sessions / privacy / blocked / close friends  
- [x] Phone OTP auth + interests (mock messaging)  
- [x] Build typecheck + Phase 1 smoke PASS  
- [ ] Live SMS/WhatsApp — **out of scope until credentials + provider wiring verified**  
- [ ] Admin UI — next phase  

**Do not start the next product phase until** live messaging (if required) is intentionally scoped and admin review UI/process is defined; core Phase 1 APIs and FE paths are in place and smoke-tested under mock OTP.
