# SecureChat — Closed Alpha Launch Gate

**Date:** 2026-10-24  
**Goal:** Confirm the current build is safe and stable enough for a **limited real-user closed test**.  
**Constraint:** No rewrite; no optional P2 feature chase (Reel comments deferred).

Artifacts: `_closed-alpha-gate-results.json`, backup under `backups/postgres-*.sql`

---

## 1) Project structure & canonical frontend

| Path | Role | Verdict |
|------|------|---------|
| `c:\xampp\htdocs\تواصل\` (8.3: `A5EC~1`) | **Source of truth** (backend + frontend + scripts) | **Canonical** |
| `c:\xampp\htdocs\tawasul\` | Junction → monorepo | Safe ASCII alias for tooling |
| `c:\xampp\htdocs\tawasul-app\frontend` | **ASCII staging copy** used to run Vite (Windows Vite breaks on Arabic real paths) | **Runtime FE for closed alpha** (sync from monorepo) |
| `c:\xampp\htdocs\securechat-web` | New ASCII staging via `scripts/sync-frontend-ascii.ps1` | Preferred long-term staging; junction `node_modules` → monorepo root |
| `c:\xampp\htdocs\securechat-fe` | Junction → monorepo `frontend` | **Not** for Vite (realpath still Arabic) |

**Nothing deleted.** Trees inspected; monorepo remains the only place to edit. Staging copies must be refreshed with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-frontend-ascii.ps1
# or robocopy monorepo frontend\src → tawasul-app\frontend\src /MIR
```

**Windows Arabic path:** Vite cannot reliably serve from the Unicode folder. Durable approach = **edit monorepo + sync to ASCII staging + run Vite there**. Scripts: `sync-frontend-ascii.ps1`, `dev-frontend.ps1`.

### Canonical runbook

```text
# Infra
cd <monorepo>
docker compose up -d postgres redis

# API
cd backend
npx tsc -p tsconfig.build.json
node dist/main.js
# health: http://127.0.0.1:3000/health

# Frontend (Windows)
powershell -ExecutionPolicy Bypass -File scripts\sync-frontend-ascii.ps1
cd C:\xampp\htdocs\securechat-web   # or tawasul-app\frontend after sync
npx vite --host 127.0.0.1 --port 5173
# open http://localhost:5173 OR http://127.0.0.1:5173
```

**Stop:** stop Node API process on `:3000`, Vite on `:5173`; `docker compose stop` if desired (does not delete volumes).

**Rollback / previous build:** restore DB dump (below); redeploy prior `backend/dist` + prior synced FE if kept. No automated release tags (folder is not a git repo).

---

## 2) CORS

### Problem
`CLIENT_ORIGIN` / `WS_ALLOWED_ORIGINS` were single-valued (`http://localhost:5173`). Browser on `http://127.0.0.1:5173` failed API calls (`Failed to fetch`).

### Fix
- Added `CLIENT_ORIGINS` (comma allowlist) → `AppConfigService.clientOrigins`
- `main.ts` CORS callback: allow only listed origins (never `*`); credentials kept for cookie mode
- `WS_ALLOWED_ORIGINS` includes both hosts; Socket.IO gateway CORS uses the same allowlist (no longer `origin: true`)
- Handshake still rejects disallowed `Origin` when present

### Result
| Check | Status |
|-------|--------|
| OPTIONS allow `localhost:5173` | **PASS** |
| OPTIONS allow `127.0.0.1:5173` | **PASS** |
| OPTIONS deny `evil.example` | **PASS** |
| Browser register/login from `127.0.0.1:5173` → feed | **PASS** |
| WS allowed origin connect | **PASS** |
| WS evil origin (polling + Origin header) | **PASS** (error) |

---

## 3) Security audit (practical)

| Area | Result | Notes |
|------|--------|-------|
| Private post like / media URL / search | **PASS** | 403 / no search hits |
| Block → DM | **PASS** | 403 |
| Group messages/members IDOR | **PASS** | 403 for non-member |
| Bookmarks isolation | **PASS** | only owner’s list |
| Logout refresh revoke | **PASS** | reuse 401 |
| Bad media MIME | **PASS** | 400 |
| Rate limits | **Present** | IP + auth scopes in `main.ts` / login lockout env |
| JWT secrets | **Fixed (HIGH)** | Were weak placeholders (`replace_this…`); **rotated** to 96-char secrets before gate (values not logged) |
| Secrets in FE | **OK** | Only `VITE_API_BASE_URL` / `VITE_WS_URL` |
| Debug in prod | **OK for alpha** | `NODE_ENV=development` local; do not ship this `.env` to public prod without hardening |
| Reel comments | **Deferred P2** | No schema/migration |

Critical regression suite re-run after JWT rotation: **5/5 PASS**.

---

## 4) Ops: health, backup, recovery

| Check | Result |
|-------|--------|
| Postgres Docker healthy | **PASS** |
| Redis Docker healthy | **PASS** |
| `/health` postgres+redis up | **PASS** |
| API restart after CORS/JWT changes | **PASS** |
| Postgres backup `scripts/backup-postgres.ps1` | **PASS** — wrote `backups/postgres-20261024-204731.sql` (~271KB) |
| Restore drill | **NOT RUN** (destructive; command documented in script, not executed) |
| WebSocket reconnect after FE reload | **PASS** (login session + feed after register on 127.0.0.1) |

---

## 5) Closed practical tests

### Automated gate (`scripts/closed-alpha-gate-smoke.mjs`)

| Test | Status |
|------|--------|
| gate.health | **PASS** |
| gate.cors-allowlist | **PASS** |
| gate.logout-refresh-revoke | **PASS** |
| gate.privacy-post-search-media | **PASS** |
| gate.block-dm | **PASS** |
| gate.group-idor | **PASS** |
| gate.bookmarks-isolation | **PASS** |
| gate.media-bad-mime | **PASS** |
| gate.ws-origin | **PASS** |
| gate.frontend-localhost | **PASS** |
| gate.frontend-127 | **PASS** |
| gate.reels-comments-schema | **NOT RUN** (deferred) |

**SUMMARY:** passed=**11** failed=**0** notRun=**1**

### Browser (desktop automation)

| Scenario | Status |
|----------|--------|
| Register + land on Home from `http://127.0.0.1:5173` | **PASS** (CORS fixed) |
| Nav: Reels / Search / Saved / Groups / Channels visible | **PASS** |
| Settings → Arabic → nav RTL labels | **PASS** |
| Physical phone / responsive device lab | **NOT RUN** |
| Full manual matrix (story create, group live chat, reel play) end-to-end in UI | **NOT RUN** this gate (covered earlier by API/RC suites; browser smoke focused on CORS + i18n + shell) |

### Prior suites still green (this session)

| Suite | Status |
|-------|--------|
| critical-launch-fixes-regression | **5/5 PASS** |
| (Earlier RC / UX / readiness / smoke) | See `14-release-candidate-qa.md` |

---

## 6) P2 features

| Item | Decision |
|------|----------|
| Reel comments / reel save | **Deferred** — requires Prisma models + migration; not required to unblock closed alpha |
| Dual FE tree cleanup delete | **Not deleted** — documented; sync scripts added |

---

## 7) Open issues

| Issue | Severity |
|-------|----------|
| Not a git repository — no tagged rollback artifact | **P2** process |
| Staging FE can drift if sync skipped | **P2** DX |
| Physical mobile QA | **P2** / **NOT RUN** |
| Restore never executed live | **P3** (backup exists) |
| Access JWT valid until TTL after logout | **P2** residual |
| Local `NODE_ENV=development` + Stream token in server `.env` | **P2** — keep server-only; rotate before any wider deploy |

No open **P0** from gate smoke after JWT rotation + CORS fix.

---

## 8) Start / stop / restore

**Start:** docker compose up -d → build/start API → sync FE → Vite `:5173`  
**Stop:** stop Node processes; optional `docker compose stop`  
**Backup:** `powershell -File scripts\backup-postgres.ps1`  
**Restore (destructive, manual):**  
`docker exec -i secure-messaging-postgres-1 psql -U app -d secure_messaging < backups\postgres-….sql`  
**Note:** JWT rotation invalidates old refresh tokens (expected).

---

## 9) Final decision

**جاهز لاختبار مغلق محدود (Closed Alpha — GO)** مع الشروط التالية:

1. استخدموا الواجهة عبر `localhost:5173` أو `127.0.0.1:5173` فقط (كلاهما في allowlist).  
2. شغّلوا Vite من نسخة ASCII مزامَنة (`tawasul-app` أو `securechat-web` بعد sync).  
3. لا تنشروا `.env` الحالي علنًا؛ الأسرار دُوِّرت محليًا لهذه البوابة.  
4. اعتبروا تعليقات الريلز وQA الهاتف الفعلي خارج نطاق هذا الإطلاق المغلق.

**ليس GO لإطلاق عام / إنتاج علني.**
