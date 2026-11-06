# Backup & Recovery — SecureChat / تواصل

## Targets

| Asset | RPO (target) | RTO (target) | Notes |
|---|---|---|---|
| PostgreSQL | ≤ 24h (dev); ≤ 1h (prod goal) | ≤ 4h | Encrypted dump off-host |
| Redis | Best-effort | ≤ 1h | Sessions rebuild via re-login |
| Media (R2/local) | ≤ 24h | ≤ 8h | Versioned/object-lock if available |

## PostgreSQL dump (lab)

```bash
docker compose exec -T postgres pg_dump -U app -d secure_messaging -Fc > backup-$(date +%Y%m%d).dump
```

Restore (destructive — staging only):

```bash
docker compose exec -T postgres pg_restore -U app -d secure_messaging --clean --if-exists < backup-YYYYMMDD.dump
```

## Rules

1. App DB role must **not** be able to delete backup buckets.
2. A backup is not successful until a restore dry-run passes on staging.
3. Alert on backup job failure (ops).
4. Never store backup encryption keys in the same host as the dump.

## Status

Automated scheduled backups + immutable object lock are **ops-owned** and not claimed as enabled by this codebase alone.
