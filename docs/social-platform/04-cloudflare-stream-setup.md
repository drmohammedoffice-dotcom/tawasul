# Cloudflare Stream Setup (optional)

Stream is **independent** of R2. Images/files use R2/local; videos may use Stream when enabled.

## Env

```env
VIDEO_STORAGE_PROVIDER=local
# set to stream when ready:
# VIDEO_STORAGE_PROVIDER=stream
CLOUDFLARE_STREAM_ACCOUNT_ID=
CLOUDFLARE_STREAM_API_TOKEN=
CLOUDFLARE_STREAM_CUSTOMER_DOMAIN=
CLOUDFLARE_STREAM_WEBHOOK_SECRET=
```

## Endpoints

- `POST /api/video/stream/direct-upload` (JWT) → `{ uploadURL, uid }`
- `POST /api/video/stream/webhook` — requires valid HMAC when secret configured

## Manual steps

1. Enable Stream in Cloudflare dashboard.
2. Create API token with Stream edit permissions.
3. Configure webhook URL to `https://your-api/api/video/stream/webhook`.
4. Set webhook signing secret into `CLOUDFLARE_STREAM_WEBHOOK_SECRET`.
5. Store returned `uid` on `MediaAsset.streamUid` when wiring reel creation (extend as needed).

## Status

- Code path implemented.
- **Not integration-tested** in this environment (no Cloudflare credentials / Docker DB down at audit time).
- Without Stream credentials, endpoint returns `503 Service Unavailable` with setup message.
- R2/local uploads continue to work when Stream is off.
