# Security Checklist

## Implemented / improved in this pass

- [x] Server-owned object keys (no client path control)
- [x] MIME allowlist on upload ticket
- [x] Complete upload verifies object via HeadObject / local stat
- [x] Size mismatch rejection when provider reports size
- [x] Media delete requires ownership
- [x] Media read auth checks uploader / message link / post visibility
- [x] Stream API token never returned to client
- [x] Webhook rejects when secret missing/invalid
- [x] Env examples use empty placeholders for Cloudflare secrets
- [x] Rate limiting retained on media ticket + local upload

## Still required before production claim

- [ ] Integration tests for IDOR on posts/stories/media
- [ ] Magic-byte / file signature validation beyond MIME string
- [ ] Orphan object cleanup job
- [ ] CORS locked to production domains on R2
- [ ] Rotate JWT secrets from example placeholders
- [ ] CSP headers review on frontend nginx
- [ ] Initialize Git + secret scanning
- [ ] Do not claim E2EE until independently verified

## Secrets handling

- Never log signed URLs or Cloudflare tokens
- Never put secrets in frontend bundles
- Keep real `.env` out of version control
