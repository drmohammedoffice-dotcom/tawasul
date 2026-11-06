import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/.env');
if (!existsSync(envPath)) {
  console.error('Missing backend/.env');
  process.exit(1);
}

const accountId = process.argv[2];
const endpoint = process.argv[3];
const bucket = process.argv[4] || 'securechat-media';

if (!accountId || !endpoint) {
  console.error('Usage: node scripts/set-cloudflare-account.mjs <accountId> <endpoint> [bucket]');
  process.exit(1);
}

function upsert(content, key, value) {
  const re = new RegExp(`(?:^|\\n)${key}=.*`);
  if (re.test(content)) {
    return content.replace(re, (m) => {
      const prefix = m.startsWith('\n') ? '\n' : '';
      return `${prefix}${key}=${value}`;
    });
  }
  return `${content.trimEnd()}\n${key}=${value}\n`;
}

let content = readFileSync(envPath, 'utf8');
content = upsert(content, 'CLOUDFLARE_ACCOUNT_ID', accountId);
content = upsert(content, 'CLOUDFLARE_R2_ENDPOINT', endpoint);
content = upsert(content, 'CLOUDFLARE_R2_BUCKET', bucket);
// Keep local until access keys are provided.
content = upsert(content, 'MEDIA_STORAGE_DRIVER', 'local');

writeFileSync(envPath, content, 'utf8');
console.log('Updated backend/.env with Account ID, Endpoint, Bucket.');
console.log('MEDIA_STORAGE_DRIVER kept as local until Access Key + Secret are set.');
console.log('Next: add CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY, then set MEDIA_STORAGE_DRIVER=r2');
