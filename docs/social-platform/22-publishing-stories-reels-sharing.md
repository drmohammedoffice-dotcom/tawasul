# SecureChat — Phase 3: Instagram-Style Publishing, Stories, Reels, Hashtags, Sharing & Content Controls (Report 22)

**Date:** 2026-10-25  
**Based on:** [20-accounts-business-verification-security.md](./20-accounts-business-verification-security.md), [21-messaging-groups-channels-calls.md](./21-messaging-groups-channels-calls.md)  
**Constraints:** No rewrite; no feature wipe; no paid external video service; no claim of full recommendation ranking or server FFmpeg trim unless present.

---

## 1) Pre-check

| Area | Before Phase 3 | After |
|------|----------------|-------|
| Post multi-media (`PostMedia.sortOrder`) | Schema + API existed; Create UI was effectively single-file | CreateStudio carousel + reorder + crop + ordered save |
| Reels | Create + feed | Hashtags, ≤60s duration enforcement, client trim, controls |
| Stories | Feed + close_friends ACL (Phase 1) | Progress bars, hold-to-pause, tap zones, unseen ring |
| Hashtags | Absent as first-class models | `Hashtag` / `PostHashtag` / `ReelHashtag`; 1–5 required for Post/Reel |
| Share / More / archive / comments off | Partial / missing | Content-controls API + FE menus |
| Video processing | No FFmpeg in repo | **Client** MediaRecorder trim + `durationSeconds` on complete; Backend rejects >60s |

---

## 2) Schema changes (Prisma `db push`)

Additive fields/models:

- `Post` / `Reel`: `commentsDisabled`, `archivedAt`, `clientRequestId` (+ unique `[authorId, clientRequestId]` for idempotent create)
- `Hashtag`, `PostHashtag`, `ReelHashtag`
- `ContentSignal` (preference storage only — **does not change feed order in this build**)
- `MediaAsset.durationSeconds` used for reel gate (existing field)

**Note:** Erroneous `User.postHashtags` / `User.reelHashtags` relation stubs were removed during validation.

---

## 3) What was implemented

### 3.1 Create menu & composers (`CreateStudio.tsx`)

- Create → **Post / Reel / Story** menu; composers keep inputs across Back/Next.
- Custom media pick button + previews (not raw file-picker-only UX).
- **Post:** multi-image select, carousel preview, reorder, remove/add, center square crop (`imageCrop.ts`), hashtags (1–5), publish progress phases, success checkmark + open post / home.
- **Reel:** duration load, trim start/end (max 60s), client trim via `videoTrim.ts` (MediaRecorder), upload with `durationSeconds`, hashtags required.
- **Story:** media + audience (everyone / close_friends); hashtags **not** required (per product).
- Idempotency: stable `clientRequestId` reused on retry after network failure (uploaded media IDs kept in refs).

### 3.2 Hashtags

- FE: chip UI + counter `n/5`, normalize/dedupe AR+EN.
- BE: `normalizeHashtags()` — Unicode letters/numbers/underscore, 1–5, reject empty/over; DTO `ArrayMinSize(1)` / `ArrayMaxSize(5)`.
- Stored as queryable `Hashtag` rows (lowercase keys for uniqueness).

### 3.3 Publish progress UI

Phases: Preparing → Uploading → Processing → Publishing → Completed / Failed.  
Percent shown only when upload/progress callbacks provide real values (not invented steady timers for server work).

### 3.4 Story viewer (`StoriesUI.tsx`)

- Avatar rail with unseen/seen styling.
- Full-screen-ish viewer, segment progress bars, auto-advance (~5s), tap left/right, hold-to-pause, close, owner delete.
- Respects close_friends + expiry via existing StoriesService; missing media via MediaFrame (no raw JSON crash).

### 3.5 More menu & preferences

**Viewer:** Block, Show more like this, Not interested, Download (authorized signed URL).  
**Owner:** Disable/enable comments, Archive, Delete (inline confirm — not `window.confirm` as primary).

Signals API returns an explicit note that **feed ranking is unchanged** in this build; toast uses `preferenceSaved` wording accordingly.

### 3.6 Share

- Share sheet: search people → DM share (`content/share-dm` writes Message rows), copy link, Web Share API when available (fallback copy).
- Links: `/p/:id`, `/reels?id=`, `/stories/:id` with privacy/block/expiry checks on share-link generation.
- Close-friends / expired stories cannot be shared past ACL (smoke: 403).

### 3.7 Owner controls (Backend)

- `PATCH posts|reels/:id/comments-disabled` — new comments 403 when disabled; existing comments kept.
- `PATCH …/archive` + `GET /content/archive` — archived hidden from public feed/explore; owner restore supported.
- Delete remains owner-only (existing posts delete path).

### 3.8 Video trim honesty

| Path | Status |
|------|--------|
| Client trim (MediaRecorder → webm) | Implemented |
| Server FFmpeg / paid transcoder | **Not present** — not added |
| Backend duration gate | Enforced (`durationSeconds` ≤ 60.05) |

If MediaRecorder cannot produce a trimmed blob, composer surfaces failure; Backend still rejects overlong duration metadata.

---

## 4) Main files

**Backend:** `prisma/schema.prisma`, `hashtags.util.ts`, `posts.service|controller.ts`, `reels.service|controller.ts`, `content-controls.service|controller.ts`, `media.controller.ts` (duration on complete), `social.module.ts`

**Frontend:** `CreateStudio.tsx`, `StoriesUI.tsx`, `PostCard.tsx`, `PostDetailPage.tsx`, `ReelsPage.tsx`, `api/content.ts`, `api/social.ts`, `lib/imageCrop.ts`, `lib/videoTrim.ts`, `social.css`, `i18n/messages.ts`, `SocialRoot.tsx` (`/p/:id`, `/create`)

**Scripts:** `scripts/phase3-publishing-smoke.mjs`; existing smokes updated to send `hashtags: ['smoke']` after mandatory hashtag rule.

**Staging:** `scripts/sync-frontend-ascii.ps1` → `C:\xampp\htdocs\securechat-web`

---

## 5) Test results (`node scripts/phase3-publishing-smoke.mjs`)

| Case | Result |
|------|--------|
| Hashtags reject empty | **PASS** (400) |
| Hashtags reject >5 | **PASS** (400) |
| Multi-image post + order + AR/EN tags + idempotency | **PASS** (3 media, tags `سفر,travel`, same id on retry) |
| Visible in feed + detail order 0,1,2 | **PASS** |
| Reel >60s rejected | **PASS** (400) |
| Reel ≤60s accepted | **PASS** |
| Comments off + archive hide + restore list | **PASS** |
| Content signal stored (no ranking claim) | **PASS** |
| Share link + DM | **PASS** |
| Download authorized URL | **PASS** |
| Close-friends story ACL (view/share) | **PASS** (403) |
| UI crop / trim / story gestures / RTL-LTR | **NOT RUN** (browser) |

**Compile:** Backend `tsc` OK; Frontend `tsc -p tsconfig.json --noEmit` OK after Phase 3 fixes.  
**Prisma:** `db push --accept-data-loss` applied for unique `clientRequestId` constraints.

---

## 6) Explicit non-claims / follow-ups

1. **No FFmpeg server pipeline** — trim is client-side; quality depends on browser MediaRecorder.
2. **ContentSignal does not reorder Feed/Explore yet** — storage only.
3. **Ads / interest targeting** — hashtag data is queryable; ad system **not** built.
4. **Browser UI cases** (carousel crop UX polish, story hold/RTL visual QA on phone) marked NOT RUN in automated smoke.
5. **Git:** workspace still not a git repository (same as Phases 1–2).

---

## 7) How to re-verify

```bat
cd /d c:\xampp\htdocs\A5EC~1\backend
npx prisma db push
npx tsc -p tsconfig.build.json --pretty false
node dist\main.js

cd /d c:\xampp\htdocs\A5EC~1
node scripts\phase3-publishing-smoke.mjs

powershell -File scripts\sync-frontend-ascii.ps1
cd /d c:\xampp\htdocs\securechat-web
npx vite --host 127.0.0.1 --port 5173
```
