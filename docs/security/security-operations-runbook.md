# Security Operations Runbook — SecureChat / تواصل

## Revoke one user (compromise / theft)

1. Identify `userId`.
2. From a trusted shell with app context, call `AuthService.revokeAllSessionsForUser(userId)` **or**:
   ```sql
   UPDATE "RefreshToken" SET "revokedAt" = NOW() WHERE "userId" = '<id>' AND "revokedAt" IS NULL;
   ```
   ```
   redis-cli DEL auth:user-sessions:<userId>
   # plus each auth:session:<sid> listed in that set before delete
   ```
3. Confirm API returns 401 for prior access tokens within seconds.
4. Notify user via out-of-band channel if available; force password reset.

## Clear rate-limit lockout (false positive)

```
redis-cli --scan --pattern 'auth:blocked:*' | xargs redis-cli DEL
redis-cli --scan --pattern 'security:ip:block:*' | xargs redis-cli DEL
redis-cli --scan --pattern 'rate:*' | xargs redis-cli DEL
```
Prefer deleting a specific key over wiping all counters.

## Rotate JWT secrets

1. Schedule maintenance window (all sessions die).
2. Set new `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` in secret store.
3. Redeploy API; flush Redis session keys optional (tokens already unverifiable).
4. Users re-authenticate.

## Private media scrape suspected

1. Check access logs for `/api/media/local-file/*` without valid tokens (403 spikes).
2. Confirm Redis `media:read-token:*` TTLs are short (`MEDIA_SIGNED_URL_TTL_SECONDS`).
3. Rotate R2 keys if signed URLs may have leaked with long TTL.

## Backup failure alert

1. Check backup job logs and object-store permissions.
2. Do not mark healthy until a restore dry-run succeeds on staging.
3. Page on-call if RPO breached.
