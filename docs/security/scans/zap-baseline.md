# OWASP ZAP baseline (Phase 2.1)

## Status: SKIP (tooling not executed end-to-end in this lab run)

### Planned local staging command

```bash
# API must be up on localhost:3000 with NODE_ENV=development
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://host.docker.internal:3000 \
  -r /zap/wrk/zap-baseline.html \
  -J /zap/wrk/zap-baseline.json
```

Mount `docs/security/scans` as `/zap/wrk` to persist reports.

### Why SKIP now

- ZAP image pull + authenticated spider against live login/MFA was not completed in this phase window without risking noisy DoS against the shared local stack.
- Unauthenticated baseline against `/health` alone is not evidence of API authz strength.

### Residual

Run ZAP against an isolated staging compose stack before production cutover. Record PASS/FAIL in a follow-up scan note; do not mark API hardened based on this SKIP.
