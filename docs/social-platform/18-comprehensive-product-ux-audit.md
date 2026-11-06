# SecureChat — Comprehensive Product & UX Audit (Report 18)

**Date:** 2026-10-24  
**Scope:** End-to-end page audit vs live code/API/DB, P0–P2 triage, UX completion for social messaging surfaces, real browser + smoke verification.  
**Constraint honored:** No rewrite, no mock media in product UI, auth/privacy/block preserved, no secrets in this report.

---

## 1) Pages audited

| Page | Design | Functional (API/DB) | Loading / empty / error / ACL |
|------|--------|---------------------|-------------------------------|
| Home / Feed | PASS (shell, stories, PostCard) | PASS (feed + secure media) | PASS (skeleton / empty / retry) |
| Explore | PASS (people + grid) | PASS (secure media + follow) | PASS; some tiles are stub/branded PNG fixtures (not broken CORP) |
| Reels | PASS (vertical player) | PASS (real MP4 playable) | PASS (processing / empty / controls) |
| Search | PASS | PASS (debounce + abort) | PASS |
| Messages | PASS (conversation list) | PASS (`GET /messages/conversations` + WS) | PASS; User ID only under **Developer tools** |
| Notifications | PASS (cards) | PASS (list API) | PASS (empty/error) |
| Profile | PASS (view vs edit split) | PASS | PASS |
| Edit Profile | PASS | PASS | PASS |
| Create Post | PASS (preview + progress) | PASS (upload → create) | PASS |
| Saved | PASS | PASS (bookmarks) | PASS |
| Groups | PASS | PASS (list/create/WS) | PASS; **UserPicker** replaces raw User ID |
| Channels | PASS | PASS (list/create/ACL) | PASS; **UserPicker** for subscribers |
| Settings | PASS (theme + language + logout) | PASS (real controls only) | PASS |
| Account menu | PASS (More / sidebar) | PASS | PASS |
| Auth Login/Register | PASS | PASS (refresh + logout revoke) | PASS (human errors, no raw 401 JSON) |

---

## 2) Issues found (pre-fix) and root causes

### P0

| ID | Issue | Root cause | Status |
|----|-------|------------|--------|
| P0-1 | Media tiles empty / “unavailable” across origins | Helmet `Cross-Origin-Resource-Policy: same-origin` blocked `<img>`/`<video>` from `:5173` → `:3000` | **Fixed in report 17** (kept) |
| P0-2 | Raw `401` JSON / blank shell after refresh | No single-flight refresh; refresh omitted `user` | **Fixed in report 16** (kept) |

### P1

| ID | Issue | Root cause | Status |
|----|-------|------------|--------|
| P1-1 | Messages required typing a User ID as primary UX | Chat shell was peer-id first; conversations API unused in UI | **Fixed (17)** — conversation list primary |
| P1-2 | Groups/Channels add-member via raw User ID | Admin forms used UUID inputs only | **Fixed (18)** — `UserPicker` + search |
| P1-3 | Create Post exposed raw file input | No preview / progress / status | **Fixed (18)** |
| P1-4 | Settings language-only | Theme/logout/privacy not organized | **Fixed (18)** |
| P1-5 | Legacy chat onboarding modal under SocialRoot | Onboarding effect fired inside nested Messages | **Fixed (18)** — auto-complete key |

### P2

| ID | Issue | Notes | Status |
|----|-------|-------|--------|
| P2-1 | Blue “SecureChat” tiles in Feed/Explore | **Real 640×640 branded fixture PNGs**, not broken media (verified `naturalWidth=640`) | Accepted fixture noise; prefer richer seed media later |
| P2-2 | Explore dark-red tiles | Mixed stub/video/missing poster; MediaFrame fallback | Remaining polish |
| P2-3 | Group/channel detail still dense vertical layout | Functional OK | Defer |
| P2-4 | Developer tools peer-id opener still visible | Intentional for alpha diagnostics | Keep collapsed |

---

## 3) Fixes & features implemented in this pass (18)

1. **`UserPicker`** (`frontend/src/app/ui/UserPicker.tsx`) — debounced search, pick user by username for Groups/Channels.
2. **`GroupsChannels.tsx`** — member/subscriber add via picker; PageLoader/EmptyState/ErrorBanner; no primary User ID fields.
3. **`MiscPages.tsx`** — Create: media preview, change-file, upload/publish status, toast on success; Notifications cards; Settings: appearance (dark/light), language, logout, privacy pointer to profile.
4. **`SearchPage.tsx`** — MediaFrame grid for post hits; people rows with avatar initials; abortable search.
5. **`SavedPage.tsx`** — unified empty/error/loader states.
6. **`App.tsx`** — skip legacy onboarding when nested under social shell.
7. **i18n** — `searchPeople`, `addMember`, create/settings theme keys (EN + AR).
8. **`social.css`** — create preview, settings cards, user-picker list, search tiles.

Prior retained work (16–17): AuthProvider/http single-flight refresh, CORP cross-origin, MediaFrame, Messages conversation list, Feed/Explore/Reels/Profile polish.

---

## 4) Main files changed (this pass)

- `frontend/src/app/ui/UserPicker.tsx` *(new)*
- `frontend/src/app/social/GroupsChannels.tsx`
- `frontend/src/app/social/MiscPages.tsx`
- `frontend/src/app/social/SearchPage.tsx`
- `frontend/src/app/social/SavedPage.tsx`
- `frontend/src/app/social.css`
- `frontend/src/app/App.tsx`
- `frontend/src/i18n/messages.ts`
- `docs/social-platform/18-comprehensive-product-ux-audit.md` *(this file)*

Staging sync: `scripts/sync-frontend-ascii.ps1` → `C:\xampp\htdocs\securechat-web` (Vite runtime on Windows ASCII path).

---

## 5) Test results

Classification rule: **PASS** only if executed; otherwise **NOT RUN**.

### Automated smoke (executed 2026-10-24)

| Suite | Result |
|-------|--------|
| `scripts/ux-completion-smoke.mjs` | **PASS** 6/6 |
| `scripts/rc-feature-smoke.mjs` | **PASS** 7/7 |
| `scripts/critical-launch-fixes-regression.mjs` | **PASS** 5/5 |
| `scripts/product-readiness-smoke.mjs` | **PASS** 19 · **NOT RUN** 1 (`stories.expiry-enforced-live`) · **FAIL** 0 |

### Frontend compile / build

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p tsconfig.json` (frontend) | **PASS** |
| `npx vite build` (`securechat-web` staging) | **PASS** |

### Browser automation (executed)

| Scenario | Result | Evidence |
|----------|--------|----------|
| Feed loads post + signed media | **PASS** | img `640×640` from `/api/media/local-file/…` |
| Messages conversation list (peer, last msg, unread) | **PASS** | screenshot + a11y tree |
| Settings theme + language + logout | **PASS** | `/settings` controls present |
| Create Post preview CTA (no raw Choose File as primary) | **PASS** | `/create` |
| Groups create + detail UserPicker | **PASS** | created “Audit Group 18”; search placeholder “Search people by username…” |
| Explore people + grid | **PASS** | Follow chips + mixed real/stub tiles |
| Reels real video play | **PASS** | `video.readyState=4`, 640×360, playing beach sample |

### Not claimed

| Item | Status |
|------|--------|
| Live 24h story expiry wait | **NOT RUN** (code-level TTL; same as readiness suite) |
| Full iPhone Safari device lab | **NOT RUN** (viewport/browser only) |
| End-to-end channel UserPicker add with second account in browser | **NOT RUN** (UI wired; ACL covered by smoke) |

---

## 6) Remaining issues (priority)

| Pri | Item |
|-----|------|
| P2 | Replace smoke stub PNGs with richer seed media so Explore/Feed look less “branded placeholder” |
| P2 | Explore video tiles: poster/thumbnail for non-image MIME |
| P2 | Collapse/relocate Messages “Developer tools” for non-dev builds |
| P2 | Groups/Channels visual density & avatars for rooms |
| P3 | Optional: unread realtime badge polish, push notification prefs (no fake toggles) |

No open **P0**. No open **P1** blocking closed-alpha functional paths covered above.

---

## 7) Correct runbook

```text
# Infra
docker compose up -d postgres redis

# Backend (from monorepo)
cd backend
npx prisma db push
npx tsc -p tsconfig.build.json --pretty false
node dist/main.js
# API: http://127.0.0.1:3000

# Frontend on Windows (ASCII staging recommended)
powershell -ExecutionPolicy Bypass -File scripts/sync-frontend-ascii.ps1
cd C:\xampp\htdocs\securechat-web
npx vite --host 127.0.0.1 --port 5173
# SPA: http://127.0.0.1:5173

# Smokes (API must be up)
node scripts/ux-completion-smoke.mjs
node scripts/rc-feature-smoke.mjs
node scripts/critical-launch-fixes-regression.mjs
node scripts/product-readiness-smoke.mjs
```

Source of truth remains the Unicode monorepo `frontend/`; staging is for Vite path safety only.

---

## 8) Verdict

**Closed-alpha ready for invited testers**, with residual **P2 polish** (seed media aesthetics, Explore video posters, developer-tool visibility).

Functional core (auth refresh, privacy/block, feed/explore media, reels playback, conversation list messaging, groups/channels ACL, create/saved/search/settings) was **re-verified** in this pass. Do not treat TypeScript/build alone as completeness — browser + smoke above are the acceptance evidence for report 18.
