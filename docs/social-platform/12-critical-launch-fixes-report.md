# SecureChat — Critical Launch Fixes Report

**Date:** 2026-10-24  
**Scope:** P0 privacy/block, P1 logout/sessions, P1 feed media, P2 follow UI + honest stubs  
**Constraint:** No rewrite; no feature deletion; no PASS without reproducing then fixing.

Artifact JSON: `_critical-launch-fixes-results.json`, `_product-readiness-results.json` (re-run).

---

## Summary

| Issue | Root cause | Result |
|-------|------------|--------|
| Private post like by stranger → 201 | Engagement APIs did not check author `isPrivate` / follow / block | **PASS** (403) |
| Block ignored for DMs | `createPrivateMessage` / conversation list had no `UserBlock` check | **PASS** (403 both directions + list) |
| Logout missing / local-only | No `POST /auth/logout`; FE only cleared storage | **PASS** (revoke + other device kept) |
| Feed/Explore no images | API omitted `secureUrl`; FE never rendered media | **PASS** (URL present + fetch OK) |
| Stories peer feed “FAIL” | Test expected network-wide visibility; product is follow-graph | **PASS** after policy-correct test (noFollow denied, follow allowed) |

---

## P0 — Privacy & block

### Root cause
- `PostsService` like/comment/bookmark did not call authorization against private authors or blocks.
- `MessagingService.createPrivateMessage` / `listPrivateConversation` ignored `UserBlock`.
- Media signed URL for posts already had some post-link checks; stranger access re-verified.

### Files changed
- `backend/src/modules/social/posts.service.ts` — `assertCanEngageWithPost`, `attachMediaUrls`
- `backend/src/modules/messaging/messaging.service.ts` — `assertNotBlocked` on send + list
- `backend/src/modules/media/media.service.ts` — attach ownership (uploader-only) [prior in this phase]

### Tests
| Test | Result |
|------|--------|
| `security.private-post-like-authz` (product-readiness) | **PASS** status=403 |
| `p0.private-post-stranger-denied` (critical regression) | **PASS** like/comment/media 403 |
| `p0.private-post-owner-allowed` | **PASS** 201 |
| `p0.dm-block-enforced` | **PASS** send 403/403 list 403 |
| `moderation.block-report` (+ DM probe) | **PASS** |

---

## P1 — Logout & sessions

### Root cause
- No logout endpoint; refresh tokens stayed valid until natural expiry.
- Intended policy: **session-scoped** logout (current device only).

### Files changed
- `backend/src/modules/auth/auth.service.ts` — `logout()` revoke refresh + Redis session by sid/jti
- `backend/src/modules/auth/auth.controller.ts` — `POST /auth/logout`, cookie clear, optional access JWT
- `frontend/src/api/client.ts` — `logout()`, `refreshSession()`
- `frontend/src/app/SocialRoot.tsx` — Logout calls API then clears local session

### Tests
| Test | Result |
|------|--------|
| `auth.logout-endpoint` | **PASS** logout=201 revokedReuse=401 otherDeviceRefresh=201 |
| `p1.logout-revokes-current-only` | **PASS** |

---

## P1 — Image display

### Root cause
- Feed/Explore responses did not attach storage read URLs.
- FE posted media but rendered caption only; relative URLs must use API origin (not Vite).

### Files changed
- `backend/src/modules/social/posts.service.ts` — `attachMediaUrls` via `MediaStorageService`
- `backend/src/modules/social/social.module.ts` — imports `MediaModule` (already)
- `frontend/src/api/social.ts` — `resolveMediaUrl`
- `frontend/src/app/SocialRoot.tsx` — `<PostMedia>`
- `frontend/src/app/social.css` — media layout

### Tests
| Test | Result |
|------|--------|
| `posts.create-feed-explore` (secure flags) | **PASS** feedSecure=true exploreSecure=true |
| `p1.feed-explore-secure-media` | **PASS** URL + HTTP fetch OK |
| Stranger media on private post | **PASS** 403 (in p0 suite) |

---

## P2 — UI honesty

### Changes
- Explore: real Follow/Unfollow against API with local state update on success.
- Profile: `isPrivate` checkbox wired to PATCH.
- Nav: removed Reels entry (API-only / no player).
- Settings: honest “coming later” copy (no fake privacy/language controls).
- Unlike on Feed.

### Files
- `frontend/src/app/SocialRoot.tsx`, `frontend/src/api/social.ts`

### Tests
| Test | Result |
|------|--------|
| `social.follow-unfollow` API | **PASS** |
| FE follow button browser E2E | **NOT RUN** (API + code wired; no Playwright this pass) |

---

## Full suite re-runs (this pass)

| Suite | Result |
|-------|--------|
| `scripts/critical-launch-fixes-regression.mjs` | **5/5 PASS** |
| `scripts/product-readiness-smoke.mjs` | **19 PASS, 0 FAIL, 1 NOT RUN** |
| `scripts/integration-smoke.mjs` | **16/16 PASS** |
| Backend `tsc -p tsconfig.build.json` | **PASS** |
| Frontend `tsc --noEmit` | **PASS** (after null-session fix) |
| Frontend production build | **PASS** (`build-frontend.mjs` / Vite) |

---

## Remaining (not launch-blockers for closed alpha messaging+posts)

- Comments / bookmarks / other-user profile FE
- Groups/Channels/Stories viewer/Reels player UI
- Full Arabic i18n
- Story purge cron; client-settable media visibility review
- Access JWT still valid until expiry after logout (refresh revoked; short TTL assumed)

**Public beta:** still **not** claimed. Closed alpha for chat + follow + photo posts is unblocked on the three former FAILs.
