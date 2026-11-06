# SecureChat — Alpha Final Polish & Real-Data Verification (Report 19)

**Date:** 2026-10-24  
**Based on:** [18-comprehensive-product-ux-audit.md](./18-comprehensive-product-ux-audit.md)  
**Constraints honored:** No rewrite; no blind DB wipe; no secrets in this report; no mock media in product UI.

---

## 1) What was executed

### 1.1 Seed / fixture tiles separated from product discovery

| Finding | Detail |
|---------|--------|
| Source | Smoke/integration scripts upload 1×1 `t.png` / stub MP4 and register `prefix_<timestamp>_<rand>` users |
| Also | Agent-session fixtures (`uxfix_*`, branded 640×640 PNGs) lived in the same tables as real posts |
| Approach | **Do not delete rows.** Add `User.isAutomatedTest` and hide those authors from **Explore** and **Reels** discovery. Also hide stub-only media (`t.png` / `test.png` / tiny image|video bytes) from Explore |

**Implemented**

- Prisma: `User.isAutomatedTest Boolean @default(false)`
- `backend/src/common/automated-test.ts` — username heuristics + stub size thresholds
- Auto-mark on register when username matches fixture patterns
- `scripts/mark-automated-test-users.mjs` — one-shot mark of existing fixtures (no deletes)
- Explore / Reels filters; Search **keeps** fixture users findable for ACL tests and intentional username lookup
- Smokes that need Explore visibility temporarily clear `isAutomatedTest`, then set it back to `true`

**Result (browser):** Explore showed only `@mohammed` real posts after remake — no `alice_*` / `ux_*` / blue SecureChat stub grid.

### 1.2 Explore video poster / thumbnail

- Schema already had `MediaAsset.thumbnailKey` and `Reel.thumbnailMediaId` — **no new transcoder**
- API now attaches `posterUrl` when `thumbnailKey` or reel `thumbnailMediaId` resolves
- `MediaFrame` grid videos: poster image when available; else metadata video frame + play badge; designed fallback (not black void) on error

### 1.3 Story expiry (live, no OS clock change)

- `stories.expiry-enforced-live` now **PASS**: create story → Prisma backdate `expiresAt` → assert gone from feed (viewer + author) and `POST /stories/:id/view` → **404**
- Privacy/block story gates remain covered by `ux.stories-secure-and-gate` / create-and-feed follow rules

### 1.4 UI polish notes

- Messages **Developer tools** (open by User ID) only in `import.meta.env.DEV`
- Empty Explore/Feed states unchanged and still used when no real content
- Arabic Settings → `dir=rtl` / `lang=ar` verified; restored to English after check

---

## 2) Main files changed

| Area | Paths |
|------|--------|
| Schema | `backend/prisma/schema.prisma` |
| Backend | `backend/src/common/automated-test.ts`, `users.service.ts`, `posts.service.ts`, `reels.service.ts`, `search.service.ts` |
| Frontend | `MediaFrame.tsx`, `ExplorePage.tsx`, `ChatScreen.tsx`, `social.css`, `i18n/messages.ts` |
| Scripts | `mark-automated-test-users.mjs`, `product-readiness-smoke.mjs`, `critical-launch-fixes-regression.mjs`, `scripts/fixtures/alpha-hero.png` |
| Docs | `docs/social-platform/19-alpha-final-polish-report.md` |

---

## 3) Test results (executed)

| Suite | Result |
|-------|--------|
| `ux-completion-smoke.mjs` | **PASS** 6/6 |
| `rc-feature-smoke.mjs` | **PASS** 6 · **NOT RUN** 1 (`rc.reels-like-unlike` — no non-fixture reels in feed after filter) · **FAIL** 0 |
| `critical-launch-fixes-regression.mjs` | **PASS** 5/5 |
| `product-readiness-smoke.mjs` | **PASS** 20/20 including **`stories.expiry-enforced-live`** |
| Frontend `tsc --noEmit` | **PASS** |
| Vite production build (`securechat-web`) | **PASS** |

### Browser (executed)

| Check | Result |
|-------|--------|
| Explore without smoke stubs / SecureChat brand tiles | **PASS** (`@mohammed` only in session) |
| Settings AR → `dir=rtl` | **PASS** |
| Settings EN → LTR restored | **PASS** |
| Native iPhone Safari lab | **NOT RUN** (browser viewport only) |

---

## 4) Remaining issues

| Pri | Item |
|-----|------|
| P2 | `rc.reels-like-unlike` NOT RUN until a non-fixture playable reel exists in DB for discovery |
| P2 | Video posts without `thumbnailKey` rely on first-frame/`poster` fallback — fine for alpha; optional offline poster generation later |
| P2 | `qaexplorer*` accounts briefly appear during smokes then remade as automated — run `mark-automated-test-users.mjs` after large smoke batches |
| P3 | Physical device lab (iPhone safe-area / keyboard) |

No open **P0**. Fixture pollution on Explore/Reels discovery treated as **closed** for closed-alpha.

---

## 5) Runbook

```text
docker compose up -d postgres redis

cd backend
npx prisma db push
npx prisma generate   # stop API first on Windows if EPERM on query engine
npx tsc -p tsconfig.build.json --pretty false
node dist/main.js

# After smokes / to hide legacy fixtures (never deletes):
node scripts/mark-automated-test-users.mjs

powershell -ExecutionPolicy Bypass -File scripts/sync-frontend-ascii.ps1
cd C:\xampp\htdocs\securechat-web
npx vite --host 127.0.0.1 --port 5173

node scripts/ux-completion-smoke.mjs
node scripts/rc-feature-smoke.mjs
node scripts/critical-launch-fixes-regression.mjs
node scripts/product-readiness-smoke.mjs
```

---

## 6) Verdict

**Suitable for closed-alpha with two real accounts**, provided fixtures are marked (`isAutomatedTest`) and Explore shows only intentional public content. Story expiry is now **proven live** without waiting 24h. Do not treat build alone as readiness — evidence above is smoke + browser.

---

## 7) Closed-alpha manual checklist (2 independent accounts)

Use two fresh usernames that do **not** look like smoke patterns (avoid `alice_…`, `ux_…`). Call them **A** and **B**.

1. **Register / login** — A and B register, logout, login again; hard-refresh stays logged in.
2. **Profile** — A sets display name + bio; B opens `/u/<A>` and sees public profile.
3. **Follow** — B follows A; A’s new post appears on B’s Home feed (not only Explore).
4. **Create post** — A uploads a real photo (>1KB), publishes; image visible on Feed and Explore for B.
5. **Engage** — B likes, comments, bookmarks; A sees notification; no full-page reload required for like.
6. **Story** — A adds a story; B (following) can view; stranger cannot; after ~24h expect disappearance (or trust automated expiry test).
7. **Messages** — A opens B from profile/Message; both send; list shows last message; no User ID field in normal UI.
8. **Groups** — A creates group, adds B via search picker; both exchange a group message.
9. **Channels** — A creates channel; B as subscriber cannot post if policy is admin-only.
10. **Block** — A blocks B; B cannot DM / engage; search hides appropriately.
11. **Privacy** — A sets private; stranger cannot like/comment; approved follower can.
12. **Settings** — Switch AR/EN (RTL/LTR) and dark/light; logout ends only this device session.
13. **Reels** — If a real video reel exists, play/mute/next; if empty, empty state (not a black player).
14. **Regression spot-check** — Explore must not show smoke usernames (`*_1792…_*`) or 1×1 blue SecureChat stubs as “community” content.
