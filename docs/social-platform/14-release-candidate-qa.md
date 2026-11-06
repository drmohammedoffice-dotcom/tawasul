# SecureChat — Release-Candidate QA Report

**Date:** 2026-10-24  
**Scope:** Final feature completion (Reels, Search, Saved, Groups/Channels WebSocket) + regression + browser smoke  
**Git:** Working tree is **not** a git repository (`fatal: not a git repository`) — no commit/push performed.

---

## 1) Features completed in this pass

| Feature | What shipped | Evidence |
|---------|--------------|----------|
| **Reels player** | Vertical stage, play/mute, prev/next, like/unlike, view count, `playable` gate (no pretend-ready video), secure URL, privacy/block on feed+engage | API + FE `/reels` + `rc.reels-*` |
| **Search** | `GET /api/search?q=` users+posts; debounce + AbortController; privacy/block filters | `rc.search-privacy` PASS |
| **Saved tab** | `GET /api/bookmarks` (+ cursor); FE `/saved` with unsave via PostCard | `rc.bookmarks-list` PASS |
| **Groups/Channels WS** | Shared Socket.IO client; join/leave; send + `*:message:new` dedupe by id; REST for initial history | `rc.groups-ws-fanout` PASS; member channel deny PASS |
| **Mobile / i18n polish** | Nav touch targets, overflow-x hidden, RTL/LTR via existing i18n; new keys for Reels/Search/Saved | Build PASS; browser nav verified |

**Explicit gaps (honest):**
- Reels **comments** and **bookmark** are **not** in Prisma schema → UI does **not** fake them (like/unlike/view only).
- Creating new reels from FE still needs a dedicated create flow with ready video (feed already has playable reels from prior data).
- Windows Vite cannot serve from Arabic path; RC browser used ASCII mirror `c:\xampp\htdocs\tawasul-app\frontend` synced from monorepo `src`.

---

## 2) Main files changed

**Backend:** `search.service/controller.ts`, `reels.service/controller.ts`, `posts.service/controller.ts` (bookmarks list), `social.module.ts`  

**Frontend:** `api/social.ts`, `lib/realtime.ts`, `app/social/ReelsPage.tsx`, `SearchPage.tsx`, `SavedPage.tsx`, `GroupsChannels.tsx` (WS), `SocialRoot.tsx`, `i18n/messages.ts`, `social.css`  

**Scripts:** `scripts/rc-feature-smoke.mjs`  

**Docs:** this file; readiness matrix conceptually superseded by RC verdict below  

---

## 3) Test results

| Suite | Result |
|-------|--------|
| `scripts/rc-feature-smoke.mjs` | **7/7 PASS** |
| `scripts/ux-completion-smoke.mjs` | **6/6 PASS** |
| `scripts/critical-launch-fixes-regression.mjs` | **5/5 PASS** |
| `scripts/product-readiness-smoke.mjs` | **19 PASS / 0 FAIL / 1 NOT RUN** (24h story expiry) |
| `scripts/integration-smoke.mjs` | **16/16 PASS** |
| Backend `tsc -p tsconfig.build.json` | **PASS** |
| Frontend `tsc --noEmit` + Vite production build | **PASS** |
| Browser (localhost:5173) nav: Reels/Search/Saved/Groups/Channels | **PASS** (routes present after ASCII Vite restart) |
| Browser on `127.0.0.1:5173` vs API CORS | **FAIL / env** — `CLIENT_ORIGIN=http://localhost:5173` only; use `localhost` host |
| Full device-lab RTL linguistic QA / Playwright matrix | **NOT RUN** |
| Story live 24h expiry wait | **NOT RUN** |
| Reels comment/save APIs | **N/A** (no schema) |

Artifacts: `_rc-feature-results.json`, `_ux-completion-results.json`, `_critical-launch-fixes-results.json`, `_product-readiness-results.json`

### RC feature detail

| Test | Status |
|------|--------|
| rc.search-privacy | **PASS** |
| rc.bookmarks-list | **PASS** |
| rc.reels-feed-endpoint | **PASS** |
| rc.reels-like-unlike | **PASS** |
| rc.groups-ws-fanout | **PASS** |
| rc.channel-ws-member-denied | **PASS** |
| rc.health-postgres-redis | **PASS** |

---

## 4) Remaining issues (severity)

| Issue | Severity |
|-------|----------|
| No ReelComment / reel bookmark models | **P2** product gap |
| Dual frontend trees (Arabic monorepo vs `tawasul-app` ASCII) can drift; stale `*.js` beside `.tsx` broke Vite once | **P2** DX / release hygiene |
| CORS: `127.0.0.1` ≠ `localhost` for FE | **P2** config |
| Access JWT still valid until TTL after logout | **P2** (refresh revoked) |
| No search pagination beyond limit; bookmarks “load more” uses `bookmarkedAt` cursor | **P3** |
| Avatar first-class bind, push, moderation console, public search abuse limits | **P2/P3** deferred |
| Stale PWA/service worker can show old shell | **P3** ops |

No P0 privacy regressions found in re-run suites (private post/comment/DM block still PASS).

---

## 5) Runtime status

| Service | Status |
|---------|--------|
| PostgreSQL (Docker) | **Up (healthy)** |
| Redis (Docker) | **Up (healthy)** |
| Nest API `:3000` | **Up** — `/health` → postgres/redis **up**, media driver **local** |
| Vite FE `:5173` | **Up** via `tawasul-app\frontend` (ASCII) |
| Git repo | **Not initialized** in project root |

---

## 6) UI checks (desktop browser automation)

| Check | Result |
|-------|--------|
| Auth gate loads (EN placeholders via i18n) | **PASS** |
| Shell nav includes Reels, Search, Saved, Groups, Channels | **PASS** on `http://localhost:5173` |
| Search / Reels / Settings route navigation | **PASS** (routes resolve) |
| Phone viewport lab / real touch devices | **NOT RUN** (CSS ≤800px rules present) |
| Arabic RTL switch end-to-end in browser | **NOT RUN** this session (i18n plumbing already tested in prior UX pass + keys added) |

---

## 7) External services (no secrets)

| Service | Needed for RC closed alpha? | Notes |
|---------|----------------------------|--------|
| Postgres + Redis | **Yes** | Docker compose |
| Local media storage | **Yes** (current) | Or R2 when configured |
| Cloudflare Stream | **Optional** | Status was enabled in readiness; Reels play local `ready` videos via signed/local URLs |
| Public webhook tunnel | Only for Stream webhook E2E | cloudflared previously used |

Do **not** put Stream/API tokens in the frontend.

---

## 8) Verdict

**Suitable for closed-alpha / internal release-candidate testing** of messaging + social (posts, profiles, stories, reels playback, search, saved, groups/channels with realtime), **provided**:

1. FE is served from an ASCII path (or origin matching `CLIENT_ORIGIN`).  
2. Operators accept known P2 gaps (no reel comments, avatar polish, dual-tree sync).  

**Does not** meet a claim of **public production launch**: remaining P2 items, incomplete device/linguistic QA, no git-backed release process in this folder, and no full Playwright suite.

**Classification:** **Closed RC — needs limited follow-ups before public beta; not blocked for trusted closed testing.**
