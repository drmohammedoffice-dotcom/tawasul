# OTP_PEPPER rotation

## Rules

1. Production **must** set `OTP_PEPPER` (≥ 16 random chars). The app refuses JWT-secret fallback when `NODE_ENV=production`.
2. OTP codes are stored as `SHA-256(pepper:code)`. Rotating the pepper invalidates outstanding unused OTP challenges (safe — users request a new code).
3. TOTP authenticator secrets are sealed with AES-GCM keyed from `otpPepper` (`seal:v1:` HKDF-like hash). **Rotating OTP_PEPPER without re-sealing breaks existing TOTP setups.**

## Safe rotation procedure (TOTP-aware)

1. Announce maintenance for users with authenticator MFA.
2. Set `OTP_PEPPER_NEXT` (future) or temporarily keep both materials in a dual-open helper (not yet implemented).
3. Preferred ops path today:
   - Notify MFA users to disable TOTP (password + code) before rotation.
   - Deploy new `OTP_PEPPER`.
   - Users re-enable TOTP.
4. Or: export/re-seal `User.totpSecretEnc` offline with a one-off migration script using old then new pepper (run under change control).

## Generating a pepper

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
