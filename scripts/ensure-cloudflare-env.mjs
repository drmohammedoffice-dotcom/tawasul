import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/.env');
if (!existsSync(envPath)) {
  console.error('Missing backend/.env');
  process.exit(1);
}

const content = readFileSync(envPath, 'utf8');
if (/(?:^|\n)CLOUDFLARE_ACCOUNT_ID=/.test(content)) {
  console.log('CLOUDFLARE_KEYS_ALREADY_PRESENT');
  process.exit(0);
}

const block = `

# Cloudflare R2 — fill from dash.cloudflare.com (never commit secrets)
# Set MEDIA_STORAGE_DRIVER=r2 after keys are filled
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET=securechat-media
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_ENDPOINT=
CLOUDFLARE_R2_PUBLIC_BASE_URL=
MEDIA_ALLOW_PUBLIC_READS=false
VIDEO_STORAGE_PROVIDER=local
CLOUDFLARE_STREAM_ACCOUNT_ID=
CLOUDFLARE_STREAM_API_TOKEN=
CLOUDFLARE_STREAM_CUSTOMER_DOMAIN=
CLOUDFLARE_STREAM_WEBHOOK_SECRET=
`;

appendFileSync(envPath, block, 'utf8');
console.log('APPENDED_CLOUDFLARE_BLOCK');
