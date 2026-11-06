# npm audit summary (Phase 2.1)

**Command:** `npm audit --audit-level=high` (workspace root)  
**Date:** 2026-11-05  
**Raw JSON:** `docs/security/scans/npm-audit.json`

## Observed (not hidden)

| Package | Severity | Notes |
|---|---|---|
| `@capacitor/android` | Critical | Mobile WebView proxy advisory — review before Play Store release |
| `@babel/plugin-transform-modules-systemjs` | High | Build toolchain; `npm audit fix` available |
| `@grpc/grpc-js` (via firebase) | High | Force-fix would downgrade firebase (breaking) — deferred |
| `@xmldom/xmldom` | High | Transitive; review electron-builder chain |
| `@babel/core` | Moderate/info | Arbitrary file read via source map comment |

## Policy

- Critical/High in **production runtime backend path** must be fixed or exceptioned with owner + expiry.
- Capacitor/electron desktop advisories tracked as residual mobile/desktop risk (not silently waived).
- No `npm audit fix --force` applied in this phase (would break Firebase).
