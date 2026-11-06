# Security Model

## Threat model assumptions
- Network attacker can observe/modify traffic.
- Server/operator compromise is possible.
- Malicious clients may spam/abuse APIs.

## Security controls

### 1) End-to-end confidentiality
- Message payload is encrypted client-side with AES-256-GCM.
- Server stores and relays ciphertext only.
- Nonce is unique per message key; auth tag verified client-side.

### 2) Key exchange and session keys
- Device identity and ephemeral keys generated client-side.
- Shared secret established using ECDH (`P-256`).
- Symmetric keys derived with HKDF and rotated frequently.

### 3) Forward secrecy
- Per-chat key epoch rotates every `100 messages` or `15 minutes`.
- Old epochs expire after bounded overlap window.

### 4) Integrity and replay resistance
- Envelope includes `clientMsgId`, `keyVersion`, and authenticated metadata.
- Duplicate `clientMsgId` per chat is rejected by DB uniqueness.

### 5) Server-side privacy controls
- No message plaintext logs.
- Security logs contain IDs/events only.
- No private key material accepted or persisted by backend.

## Security architecture diagram explanation

```text
Client A (encrypt) ---> WSS ---> Gateway ---> Chat Service ---> DB(ciphertext)
    |                                         |
    |------ encrypted envelope metadata ------|
                                              |
                                       Redis Pub/Sub
                                              |
Client B <--- WSS <--- Gateway <--- event with ciphertext only
```

This enforces relay-only behavior. Even if backend data is exposed, attackers see encrypted blobs, not plaintext content.
