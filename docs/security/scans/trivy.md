# Trivy (Phase 2.1)

## Status: PASS (scan completed)

First attempt failed (`context deadline exceeded` while walking `ai-service/.venv`).  
Retry with `--skip-dirs node_modules,.git,ai-service/.venv,backend/dist,frontend/dist` and `--timeout 10m` succeeded.

**Artifact:** `docs/security/scans/trivy-fs.json`  
**Totals (HIGH+CRITICAL):** Critical **3**, High **27** across 4 language targets.

### Notable targets

| Target | Sample findings |
|---|---|
| `backend/go.mod` | CRITICAL `jackc/pgx/v5` (CVE-2026-33815/33816); HIGH `golang-jwt`, `x/crypto` |
| `package-lock.json` | HIGH `@grpc/grpc-js`, `body-parser`, `engine.io`, others |

### Command used

```bash
docker run --rm -v "%CD%:/src" aquasec/trivy:0.58.1 fs \
  --scanners vuln --severity HIGH,CRITICAL --timeout 10m \
  --format json --output /src/docs/security/scans/trivy-fs.json /src \
  --skip-dirs node_modules --skip-dirs .git \
  --skip-dirs ai-service/.venv --skip-dirs backend/dist --skip-dirs frontend/dist
```

Findings are recorded, not waived. CI job `trivy-fs` remains in `.github/workflows/security.yml`.
