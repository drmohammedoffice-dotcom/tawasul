# Security Architecture — SecureChat / تواصل

## Trust boundaries

```
Internet clients (SPA / mobile)
        |  HTTPS + WSS
        v
   NestJS API + Socket.IO
        |------------------+------------------+
        v                  v                  v
   PostgreSQL           Redis              Object storage (R2/S3/local)
   (accounts, DMs,      (sessions,         (media blobs;
    posts, tokens)       rate limits,        private via signed /
                         media tokens)       Redis capability URLs)
```

- Browser is **never** a trust boundary for authorization.
- AI / moderation workers must not scan private message content automatically.
- Admin role ≠ access to encryption keys or raw password hashes via UI.

## AuthN model

1. Login / register → bcrypt password verify → issue access JWT (short) + refresh JWT.
2. Refresh token stored as bcrypt hash in Postgres; Redis holds session metadata keyed by `sid`.
3. Access JWT claims: `sub`, `sid`, `jti`, `deviceId`, `type=access`.
4. Every REST request: Passport JWT + **live Redis session** match.
5. Every WS connect / sensitive event: JWT verify (HS256 only) + Redis session match.
6. Logout / password-compromise path: revoke refresh row(s) + delete Redis session(s).
7. Refresh reuse (valid hash of already-revoked token): revoke **all** user sessions.

## AuthZ model (target)

- Deny by default on server.
- Ownership checks on media, messages, groups, channels.
- Roles: `user` < `moderator` < `admin` < `super_admin` (super admin not creatable via public register).
- Admin actions audited without storing secrets or DM bodies.

## Media access

- Upload tickets / read tokens in Redis with TTL.
- Hybrid R2+local: on-disk mirrors served only with Redis capability token for non-public purposes.
- Publicish purposes (`avatar`, `cover`, `sticker`) may be readable without token for product UX; private post/chat media require token.

## Rate limiting

- Redis counters: `rate:{scope}:{ip}`, `auth:failed:*`, `auth:blocked:*`, `security:ip:block:*`.
- Applied on login, media, WS events, and other call sites via `SecurityRateLimitService` / `AuthRateLimitService`.

## Encryption claims

- Transport: TLS (ops).
- At-rest: DB/disk encryption is ops-owned; app hashes passwords and refresh tokens.
- **No E2EE claim** until a reviewed protocol and key management exist.
