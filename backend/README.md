# Backend Services

## Running profile
- `cmd/api-gateway`: main runtime in local/dev profile.
- `cmd/auth-service`, `cmd/chat-service`, `cmd/media-service`, `cmd/notification-service`: dedicated entrypoints for split deployment.

## Production split recommendation
1. Move auth handlers into `auth-service` HTTP app.
2. Keep gateway as auth-verifying edge + websocket fanout.
3. Run chat persistence in separate service with queue integration.
4. Route inter-service calls via gRPC or internal REST with mTLS.

## Security notes
- Never add plaintext message logging.
- Never persist private key material.
- Reject non-TLS traffic at ingress.
