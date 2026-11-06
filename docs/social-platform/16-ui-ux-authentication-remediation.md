# SecureChat — UI/UX & Authentication Remediation

**Date:** 2026-10-24  
**Scope:** Fix raw 401 JSON on Feed, session refresh/logout, professional layout/navigation, motion & mobile polish — without rewrite or fake data.

---

## 1) Root cause of 401 / raw JSON

| Finding | Detail |
|---------|--------|
| **Failing request** | Authenticated calls via `frontend/src/api/social.ts` (`/feed`, `/stories/feed`, …) |
| **Why** | Access JWT TTL is **15m**. Session stayed in `localStorage` after expiry. |
| **UI bug** | `authRequest` did `throw new Error(await response.text())`, so Nest body `{"message":"Unauthorized","statusCode":401}` rendered as the page error. |
| **Missing behavior** | No refresh-on-401, no single-flight refresh, no human error mapping. |
| **Secondary crash** | `/auth/refresh` returned **tokens only** (no `user`). After refresh, Shell read `session.user.username` without optional chaining → blank white/black screen after reload. |

### Fixes applied

1. **`api/http.ts`** — shared client: host alignment (`localhost` ↔ `127.0.0.1`), proactive refresh near expiry, **single-flight** refresh, one retry on 401, human `ApiError` / `SessionExpiredError` (never raw JSON).
2. **`auth/AuthProvider.tsx`** — session bootstrap, scheduled refresh, force-logout notice → login with clear copy.
3. **`api/social.ts` / `api/client.ts`** — routed through `http` layer; logout uses API then clears local session.
4. **Backend `auth.service.ts` `refreshToken`** — response now includes `user` (same shape as login).
5. **Frontend merge** — if refresh payload omits user, keep previous `user`; else force logout.
6. **Shell** — safe `session?.user?.username`; Logout moved into **account / More menus** (not a stretched primary button).

---

## 2) Files changed (high level)

**Auth / HTTP**

- `frontend/src/api/http.ts` *(new)*
- `frontend/src/api/client.ts`
- `frontend/src/api/social.ts`
- `frontend/src/lib/apiError.ts` *(new)*
- `frontend/src/lib/sessionBridge.ts` *(new)*
- `frontend/src/auth/AuthProvider.tsx` *(new)*
- `frontend/src/lib/realtime.ts`
- `backend/src/modules/auth/auth.service.ts`

**UI / UX**

- `frontend/src/app/SocialRoot.tsx` — sidebar + mobile top/bottom nav + account menu
- `frontend/src/app/social.css`, `frontend/src/app/styles.css`, `frontend/index.html`
- `frontend/src/app/social/FeedPage.tsx`, `PostCard.tsx`, `ExplorePage.tsx`
- `frontend/src/app/ui/Icons.tsx`, `States.tsx`, `Toast.tsx` *(new)*
- `frontend/src/app/App.tsx` — uses AuthProvider + `resolveWsUrl`
- `frontend/src/i18n/messages.ts`
- `frontend/src/main.tsx` — theme init
- `scripts/sync-frontend-ascii.ps1` — ships `tsconfig.base.json` for ASCII staging

---

## 3) Visual / navigation / motion

- Design tokens: Plus Jakarta Sans + Noto Sans Arabic; refined dark/light CSS variables; logical spacing.
- **Desktop:** sticky sidebar (primary + secondary links), account trigger with Settings/Logout popover.
- **Mobile:** top bar (search/alerts/more) + bottom nav (Home / Explore / Reels / Messages / Profile); safe-area padding; ~44px touch targets.
- Feed: skeleton loading, empty state CTAs, error banner + retry, infinite scroll sentinel, optimistic like/bookmark with rollback.
- Motion: short opacity/transform transitions; `prefers-reduced-motion` disables animations.
- Toasts for non-critical feedback (e.g. save).

---

## 4) Test results

| Test | Result | Evidence |
|------|--------|----------|
| API health (Postgres/Redis) | **PASS** | `GET /health` → `ok` |
| Register / login / feed with valid token | **PASS** | API + browser login → `/feed` |
| Refresh rotates tokens; old refresh rejected | **PASS** | API smoke |
| Refresh response includes `user` | **PASS** | `refresh_has_user=True` |
| Corrupted access + valid refresh → silent restore | **PASS** | Browser: feed OK, `accessOk=true`, `hasUser=true`, no JSON |
| Expired/invalid session → login, human message (no raw JSON) | **PASS** | `hasJson=false`, `hasUnauthorized=false` on feed error paths |
| Logout API + clear local → AuthGate | **PASS** | Browser More → Logout → Login form |
| Feed empty state / no 401 JSON | **PASS** | Browser snapshot + screenshot |
| Desktop sidebar + account menu | **PASS** | 1280×800 snapshot; Main nav + `@user` account |
| Mobile bottom nav + More menu | **PASS** | 390-class layout earlier; Home active |
| EN LTR / AR RTL switch | **PASS** | Settings locale; labels switch (Home↔الرئيسية) |
| TypeScript `tsc --noEmit` | **PASS** | Clean after fixes |
| Production `npm run build` | **PASS** | Vite build + PWA; `BUILD_PASS` |
| Physical iPhone device lab | **NOT RUN** | No device attached; mobile viewport + safe-area CSS verified in browser |
| Infinite scroll with large feed | **NOT RUN** | Empty feed for test user (API cursor path present) |
| Like/comment/save on real post media | **NOT RUN** | Empty feed; code paths unchanged + optimistic UI wired |

---

## 5) Open issues

| Issue | Severity | Notes |
|-------|----------|-------|
| Story “Add story” still uses native file input | Low | Styled wrapper added; further custom picker optional |
| Chat landing/onboarding UI inside `/messages` still older shell | Low | Nested under new social chrome; not part of 401 bug |
| Physical phone / Capacitor field test | Medium | Recommended before wider alpha |
| Access token 15m requires reliable refresh | Info | Now covered; keep monitoring concurrent tabs |

---

## 6) Runbook

```powershell
# Infra
cd <monorepo>
docker compose up -d postgres redis

# API
cd backend
npx tsc -p tsconfig.build.json
node dist/main.js
# http://127.0.0.1:3000/health

# Frontend (Windows — ASCII staging)
powershell -ExecutionPolicy Bypass -File scripts\sync-frontend-ascii.ps1
cd C:\xampp\htdocs\securechat-web
npx vite --host 127.0.0.1 --port 5173
# Open http://127.0.0.1:5173 or http://localhost:5173
```

**Stop:** end Node on `:3000` and Vite on `:5173`.  
**Edit source of truth:** monorepo `frontend/` then re-sync. Do not treat staging as canonical.

---

## 7) Decision

**Ready for closed-alpha UI/auth retest** on desktop + mobile browser: authentication no longer dumps JSON, sessions renew safely, logout is correct, and navigation/feed empty/error states are usable.

Still **not** a public launch claim. Remaining gaps are polish and device-lab coverage, not the original 401 crash.
