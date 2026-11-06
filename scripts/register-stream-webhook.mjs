/**
 * Registers Cloudflare Stream VOD webhook URL and prints ONLY non-secret fields
 * plus whether a secret was returned (value goes to stdout as SECRET=... for you to copy into .env).
 *
 * Usage:
 *   set WEBHOOK_URL=https://xxxx.trycloudflare.com/api/video/stream/webhook
 *   node scripts/register-stream-webhook.mjs
 *
 * Reads CLOUDFLARE_STREAM_* from backend/.env
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const accountId = env.CLOUDFLARE_STREAM_ACCOUNT_ID;
const token = env.CLOUDFLARE_STREAM_API_TOKEN;
const notificationUrl = process.env.WEBHOOK_URL || '';

if (!accountId || !token) {
  console.error('Missing CLOUDFLARE_STREAM_ACCOUNT_ID or CLOUDFLARE_STREAM_API_TOKEN in backend/.env');
  process.exit(1);
}
if (!notificationUrl.startsWith('http')) {
  console.error('Set WEBHOOK_URL to a public https URL ending with /api/video/stream/webhook');
  process.exit(1);
}

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/webhook`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ notificationUrl })
});
const json = await res.json();
if (!res.ok || !json.success) {
  console.error(JSON.stringify({ status: res.status, errors: json.errors || json }, null, 2));
  process.exit(1);
}

const secret = json.result?.secret;
console.log(
  JSON.stringify(
    {
      ok: true,
      notificationUrl: json.result?.notificationUrl,
      modified: json.result?.modified,
      secretReturned: Boolean(secret)
    },
    null,
    2
  )
);
if (secret) {
  console.log(`\nAdd this line to backend/.env then restart API:\nCLOUDFLARE_STREAM_WEBHOOK_SECRET=${secret}`);
}
