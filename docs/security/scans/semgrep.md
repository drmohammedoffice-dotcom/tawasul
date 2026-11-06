# Semgrep (Phase 2.1)

## Status: SKIP

`npx semgrep` could not resolve an executable in this environment (`npm error could not determine executable to run`).

### Recommended install (ops)

```bash
pip install semgrep
semgrep --config p/owasp-top-ten --config p/nodejs --json -o docs/security/scans/semgrep.json backend/src
```

Or Docker:

```bash
docker run --rm -v "%CD%:/src" returntocorp/semgrep semgrep --config=p/owasp-top-ten /src/backend/src
```

Do not treat this SKIP as a clean bill of health.
