# Testing and Acceptance

## Tests run in this environment

| Test | Result |
|------|--------|
| Media MIME/object-key unit checks (`run-media-unit-checks.cjs`) | **PASS** |
| `prisma generate` | **PASS** |
| `prisma db push` | **FAIL** — PostgreSQL unreachable (`localhost:5432`), Docker Desktop not running |
| Nest `nest build` | **PASS** |
| R2 live upload | **NOT RUN** — no Cloudflare credentials |
| Stream webhook/upload | **NOT RUN** — not configured |
| Frontend E2E social publish | **NOT RUN** — DB/API stack down |

## How to run locally after starting DB/Redis

```bash
# 1) Start Docker Desktop, then:
docker compose up -d postgres redis

# 2) Apply schema (additive; no reset)
cd backend
npx prisma db push

# 3) Unit checks
node src/modules/media/storage/run-media-unit-checks.cjs

# 4) API
npm run dev

# 5) Frontend
cd ../frontend
npm run dev
```

## Acceptance criteria mapping

| Criterion | Status |
|-----------|--------|
| Existing messaging/auth preserved in code | YES (modules retained) |
| Upload image via secure ticket flow (local) | Code ready; runtime needs DB/Redis |
| Publish post with media | Code ready; needs DB |
| Chat media attach without leaking storage secrets | Tickets return URLs only; secrets stay server-side |
| Local storage works without Cloudflare | YES (`MEDIA_STORAGE_DRIVER=local`) |
| R2 switchable via env | YES (`r2`) |
| Stream optional | YES |
| Automated suite for all 18 required cases | **PARTIAL** — helpers covered; full Nest e2e pending |
