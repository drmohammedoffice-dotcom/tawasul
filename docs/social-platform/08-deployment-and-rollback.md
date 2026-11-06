# Deployment and Rollback

## Safe schema apply

This repo historically used `prisma db push` (no migration history folder).

Recommended for this phase:

```bash
cd backend
npx prisma db push
```

**Do not** run `prisma migrate reset` against real data.

If you introduce formal migrations later:

```bash
npx prisma migrate dev --name social_platform_phase1
```

Review SQL before applying to staging/production.

## Rollback strategy

1. **Code rollback:** redeploy previous backend/frontend artifacts.
2. **Schema:** new tables/columns are additive; rollback code can ignore them. Dropping tables requires an explicit DBA plan — not automated here.
3. **Media:** switching `MEDIA_STORAGE_DRIVER` from `r2` back to `local` does not migrate objects. Keep R2 objects until a migration job exists.
4. **Feature flags via env:** disable Stream with `VIDEO_STORAGE_PROVIDER=local`.

## Backup

- PostgreSQL: schedule `pg_dump` daily before production traffic.
- R2: enable bucket versioning if available; document retention.
- Redis: treat as ephemeral (sessions/rate limits/pubsub).

## Health

- `GET /health` — postgres/redis dependency status (existing)
- After R2 enablement: monitor complete-upload failure rates
