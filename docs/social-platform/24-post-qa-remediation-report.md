# SecureChat — Post-QA Remediation Report (24)

**Date:** 2026-10-25  
**Based on:** [23-comprehensive-final-qa-report.md](./23-comprehensive-final-qa-report.md)  
**Constraint:** No rewrite, no DB wipe, no secrets in this document, no claiming live SMS/calls without evidence

---

## Executive verdict

| Question | Answer |
|----------|--------|
| Closed alpha? | **Yes** — improved vs report 23 |
| Internal release candidate? | **Conditional yes** for staff testing with mock OTP + STUN calls + local media + FFmpeg on API host |
| Public release candidate? | **No** — live SMS/WhatsApp credentials not configured; dual-browser call media still NOT RUN; TURN not configured |

Automated remediation suite: **PASS 14 · FAIL 0 · NOT RUN 0** (`scripts/post-qa-remediation-smoke.mjs`).

---

## Gap remediation table

| Gap (from report 23) | Before | Change | Actual test | Result | Files | External remaining |
|----------------------|--------|--------|-------------|--------|-------|--------------------|
| Admin verification UI / cycle | API only; no console | Admin list/detail/review UI; detail with signed doc URLs; decision recorded (`reviewedById`, note, status) | Promote test user to admin via DB; approve another user’s request; docs listed | **PASS** | `verification.service.ts`, `accounts.controller.ts`, `AdminVerificationPage.tsx`, `accounts.ts`, `SocialRoot.tsx` | Promote real admins via ops (`User.role=admin`) |
| Self-approve | Admin role only | Explicit forbid `req.userId === adminId` | Bob admin reviews own request → 403 | **PASS** | `verification.service.ts` | — |
| Concurrent registration reuse | Approved-only clash | Clash on pending/more_info/approved | Second submit same registration → 409 | **PASS** | `verification.service.ts` | — |
| Document ACL | Media ACL (prior) | Admin detail mints URLs only for admin; applicants never get peer docs | Admin detail returns `secureUrl`; non-admin queue 403 | **PASS** | `verification.service.ts` + prior media ACL | — |
| OTP SMS/WhatsApp live | Mock + unwired Twilio stub | Real Twilio REST when `OTP_MESSAGING_DRIVER=live` + SID/token/from; WhatsApp via `TWILIO_WHATSAPP_FROM`; `GET /auth/otp/provider-status` | Status `mode=mock`, `smsConfigured=false` | **PASS** (status) · live send **BLOCKED** | `messaging-provider.ts`, `accounts.controller.ts` | Twilio credentials + live driver |
| Server video trim ≤60s | Client MediaRecorder only; no ffmpeg | Installed FFmpeg; `GET /media/trim/status`, `POST /media/trim`; CreateStudio prefers server trim | `available=true`; trim end=90 → 400 | **PASS** | `video-trim.service.ts`, `media.controller.ts`, `media.module.ts`, `CreateStudio.tsx` | FFmpeg on every API host |
| Live WebRTC A/V | Signaling PASS; media NOT RUN | ICE note still STUN-only; no fake PASS | ice-servers returns TURN hint | **PARTIAL** / media **NOT RUN** | (existing `call.service.ts`) | `WEBRTC_TURN_*`, dual clients |
| Archive UI | API only | `/archive` page: list, restore, delete (owner) | Archive → list → restore → appears in feed | **PASS** | `ArchivePage.tsx`, `content.ts`, `SocialRoot.tsx`, owner getById archived | — |
| Hashtag search | Storage only | Search returns `hashtags` + `taggedPosts` with privacy/block | Search `رمضان` → tags=1 tagged=1 | **PASS** | `search.service.ts`, `SearchPage.tsx`, `social.ts` | Ads still out of scope |
| Recommendations | Signal storage only | Deterministic Explore rank: demote `not_interested`, boost `more_like_this` tags + interests | Explore returns list; signal note updated | **PASS** (deterministic) | `posts.service.ts`, `content-controls.service.ts` | Not ML / not ads |

---

## NOT RUN items from report 23 — disposition

| Item | Disposition after remediation |
|------|-------------------------------|
| UI crop carousel progress | Still **NOT RUN** (browser visual) — code unchanged |
| UI video trim editor | Server path now tested via API; client MediaRecorder fallback remains for no-FFmpeg hosts |
| UI story viewer gestures | Still **NOT RUN** (browser) |
| UI RTL/LTR matrix | Still **NOT RUN** (browser) |
| RC reels like/unlike | Still **NOT RUN** when feed empty of playable reels |
| Gate reel comments schema | Still deferred — no `ReelComment` model |

---

## Build / typecheck (this phase)

| Check | Result |
|-------|--------|
| Backend `tsc -p tsconfig.build.json` | **PASS** |
| Frontend `tsc -p tsconfig.json --noEmit` | **PASS** |
| Prisma validate | (schema unchanged structurally) |
| API restart + health | **PASS** |
| FE sync to `securechat-web` | **PASS** |
| Production Vite/Nest package build | **NOT RUN** this phase |

---

## Security notes

- Verification documents: admin-only signed URLs; no plaintext national ID / registration in API (hashes + `[redacted]`).
- OTP codes never logged; Twilio errors log status only.
- Self-review of verification blocked even if user has `role=admin`.
- Media trim rejects clip > 60s in service (not only FE).

---

## External configuration checklist (no secret values)

| Need | Env / ops | Current lab |
|------|-----------|-------------|
| Mock OTP | `OTP_MESSAGING_DRIVER=mock` | Active |
| Live SMS | `OTP_MESSAGING_DRIVER=live`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Missing → BLOCKED |
| Live WhatsApp | + `TWILIO_WHATSAPP_FROM` (or WhatsApp-capable from) | Missing → BLOCKED |
| Live email 2FA | Mailer not wired | BLOCKED |
| FFmpeg | On PATH for API process | Installed (winget Gyan.FFmpeg) this session |
| TURN | `WEBRTC_TURN_URL`, `WEBRTC_TURN_USERNAME`, `WEBRTC_TURN_CREDENTIAL` | Missing → STUN-only |
| Admin users | `User.role = admin` | Manual / SQL in smoke only |

---

## How to re-verify

```bat
cd /d c:\xampp\htdocs\A5EC~1\backend
npx tsc -p tsconfig.build.json --pretty false
node dist\main.js

cd /d c:\xampp\htdocs\A5EC~1
node scripts\post-qa-remediation-smoke.mjs

powershell -File scripts\sync-frontend-ascii.ps1
```

Artifact: `docs/social-platform/qa-artifacts/post-qa-remediation-smoke.json`

---

## Release decision (evidence-based)

**CLOSED ALPHA** confirmed; **INTERNAL RELEASE CANDIDATE** only for environments that accept mock OTP and STUN-only calls, with FFmpeg present for server trim.

**Not PUBLIC RELEASE CANDIDATE** until live Twilio (or equivalent) delivery is verified end-to-end, TURN + dual-client call media pass, and ops process for admin promotion is documented outside smoke SQL.
