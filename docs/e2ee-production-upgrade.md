# E2EE Production Upgrade Guide

This project now includes a **client-side simulation utility** in `shared/src/crypto/e2ee.ts` using:
- ECDH (`P-256`) for key agreement simulation
- HKDF-SHA256 for per-chat key derivation
- AES-256-GCM for message encryption/decryption

## Current simulation model

1. Each client generates an ECDH keypair.
2. Clients exchange public keys.
3. `deriveChatSessionKey()` creates a per-chat AES session key.
4. `encryptMessage()` generates encrypted payload `{ ciphertext, nonce, keyId }`.
5. Server stores and relays **encrypted payload only**.
6. Receiver decrypts with `decryptMessage()`.

## Security rule enforced

- Server must never decrypt messages.
- Server must store encrypted content only (`encryptedContent`).
- Decryption logic should remain in web/mobile clients only.

## Production-grade E2EE upgrades

To move from simulation to real-world secure messaging:

### 1) Device identity + trust model
- Use long-term identity keys per device.
- Add device verification (QR/SAS/fingerprint comparison).
- Maintain trusted-device registry per account.

### 2) X3DH / pre-key bundle onboarding
- Replace simple ECDH exchange with X3DH-like pre-key bundles.
- Support asynchronous first-message encryption when recipient is offline.

### 3) Double Ratchet for forward secrecy
- Rotate message keys per message chain.
- Enable post-compromise security and future secrecy.
- Store only minimal ratchet state on clients.

### 4) Key backup and recovery
- Use user-controlled encrypted key backup (passphrase-derived key, hardware key, or secure enclave).
- Never store raw private keys server-side.

### 5) Metadata minimization
- Encrypt more metadata fields where possible (attachments refs, reply links).
- Reduce server-visible routing metadata.

### 6) Strong randomness and platform hardening
- Use platform secure RNG only.
- Keep private keys in OS keystore/secure enclave (WebCrypto + native secure storage on mobile).

### 7) Replay protection and authentication
- Add message counters/ratchet numbers.
- Authenticate sender identity and reject replayed envelopes.

### 8) Multi-device consistency
- Per-device sessions and key epochs.
- Signed key updates and key transparency audit logs.

## Suggested next implementation phases

1. Introduce a device keys API for publishing public pre-keys.
2. Add client session bootstrap endpoint (returns recipient pre-key bundle).
3. Implement signed key rotation and key versioning in message envelope.
4. Migrate from static chat key derivation to ratcheting message keys.
