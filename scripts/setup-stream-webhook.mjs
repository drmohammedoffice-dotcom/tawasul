/**
 * Full local Stream webhook setup:
 * 1) Wait for API :3000
 * 2) Expect CLOUDFLARE_TUNNEL_URL env (public base without path)
 * 3) Register webhook with Cloudflare
 * 4) Write CLOUDFLARE_STREAM_WEBHOOK_SECRET into backend/.env
 * Does not print the secret value.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'backend/.env');

function loadEnv(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

function setEnv(file, key, value) {
  let text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text += `\n${key}=${value}\n`;
  fs.writeFileSync(file, text);
}

const tunnelBase = (process.env.CLOUDFLARE_TUNNEL_URL || '').replace(/\/$/, '');
if (!tunnelBase.startsWith('http')) {
  console.error('MISSING_TUNNEL_URL');
  process.exit(2);
}

const env = loadEnv(envPath);
const accountId = env.CLOUDFLARE_STREAM_ACCOUNT_ID;
const token = env.CLOUDFLARE_STREAM_API_TOKEN;
if (!accountId || !token) {
  console.error('MISSING_STREAM_CREDS');
  process.exit(2);
}

const notificationUrl = `${tunnelBase}/api/video/stream/webhook`;
console.log(JSON.stringify({ registering: true, notificationUrl }));

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/webhook`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ notificationUrl })
});
const json = await res.json();
if (!res.ok || !json.success || !json.result?.secret) {
  console.error(JSON.stringify({ status: res.status, errors: json.errors || json }, null, 2));
  process.exit(1);
}

setEnv(envPath, 'CLOUDFLARE_STREAM_WEBHOOK_SECRET', json.result.secret);
console.log(
  JSON.stringify({
    ok: true,
    notificationUrl: json.result.notificationUrl,
    secretWritten: true,
    modified: json.result.modified
  })
);
