# Cloudflare R2 Setup

## Env vars (names only — never commit real secrets)

```env
MEDIA_STORAGE_DRIVER=r2
# or MEDIA_STORAGE_PROVIDER=r2

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_ENDPOINT=
# Optional public CDN/custom domain for public objects only
CLOUDFLARE_R2_PUBLIC_BASE_URL=
MEDIA_ALLOW_PUBLIC_READS=false
MEDIA_SIGNED_URL_TTL_SECONDS=900
```

If `CLOUDFLARE_R2_ENDPOINT` is empty, the backend derives:

`https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`

Region used for R2: `auto`.

## Manual Cloudflare steps

1. Create an R2 bucket.
2. Create an R2 API token with Object Read & Write on that bucket.
3. Put Account ID, bucket name, Access Key ID, Secret into `backend/.env` (local only).
4. Configure **CORS** on the bucket for your app origins only, e.g.:
   - Allowed Origins: `http://localhost:5173`, `https://your-domain.com`
   - Allowed Methods: `GET`, `PUT`, `HEAD`
   - Allowed Headers: `Content-Type`, `Authorization` (as needed)
5. Keep bucket **private**. Use signed GET URLs for private media.
6. Only set `CLOUDFLARE_R2_PUBLIC_BASE_URL` + `MEDIA_ALLOW_PUBLIC_READS=true` if you intentionally serve public objects.

## App flow

1. `POST /api/media/upload-ticket` (JWT)
2. Client `PUT`/`POST` file to returned URL (direct to R2 or local)
3. `POST /api/media/complete` — backend `HeadObject` verifies existence/size/mime
4. Attach media to post/story/message

## Local development without Cloudflare

```env
MEDIA_STORAGE_DRIVER=local
```

No R2 credentials required.
