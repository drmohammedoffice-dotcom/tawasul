# Incident Response Plan — SecureChat / تواصل

## Severity levels

| Level | Examples | Response time |
|---|---|---|
| Sev-1 | Confirmed account takeover at scale, DB leak, ransomware | Immediate |
| Sev-2 | Refresh-token theft family, admin privilege abuse, private media scrape | < 1 hour |
| Sev-3 | Elevated brute-force, single-account compromise, misconfig | < 4 hours |
| Sev-4 | Suspicious anomalies, failed backup, dependency CVE | Next business day |

## Immediate actions (containment)

1. **Record** incident ID, start UTC time, detector, initial scope.
2. **Identify** affected `userId`s, sessions (`sid`), services (API/WS/media/DB/Redis).
3. **Revoke sessions**
   - Per user: call `AuthService.revokeAllSessionsForUser(userId)` (or logout-all API when exposed).
   - Bulk: revoke refresh rows in Postgres + delete `auth:session:*` / `auth:user-sessions:*` in Redis.
4. **Rotate secrets** if JWT/Redis/R2/DB credentials may be exposed — deploy new env, restart API, force re-login.
5. **Isolate** without destroying evidence: snapshot DB/Redis (if possible), preserve structured logs with correlation IDs.
6. **Scope data exposure**: which tables/objects were readable (users, DMs, media keys).
7. **Restore** from known-good backup only after malware/integrity check.
8. **Root cause** write-up within 72h for Sev-1/2.
9. **Prevent recurrence**: patch, add detection rule, update checklist.

## Do / Don't

- **Do** invalidate sessions before notifying users when takeover is likely.
- **Do** preserve audit logs; never edit them from the admin UI.
- **Don't** log message bodies, passwords, raw tokens, or OTP codes.
- **Don't** wipe hosts before collecting volatile evidence if investigation is needed.
- **Don't** claim E2EE or “unhackable” status in public notices.

## Contacts (fill for production)

| Role | Name | Channel |
|---|---|---|
| CISO / owner | _TBD_ | |
| On-call eng | _TBD_ | |
| Hosting / Cloudflare | _TBD_ | |
| Legal / privacy | _TBD_ | |

## Post-incident checklist

- [ ] All compromised sessions revoked
- [ ] Secrets rotated and old ones retired
- [ ] Users notified if personal data exposed (per applicable law)
- [ ] Detection rule added/tuned
- [ ] Security docs updated
- [ ] Backup restore verified if restore was used
