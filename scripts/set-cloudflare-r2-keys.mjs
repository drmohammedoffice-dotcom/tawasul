import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/.env');
if (!existsSync(envPath)) {
  console.error('Missing backend/.env');
  process.exit(1);
}

const accessKeyId = process.argv[2];
const secretAccessKey = process.argv[3];
const accountId = process.argv[4];
const endpoint = process.argv[5];
const bucket = process.argv[6] || 'securechat-media';

if (!accessKeyId || !secretAccessKey || !accountId || !endpoint) {
  console.error('Missing required arguments');
  process.exit(1);
}

function upsert(content, key, value) {
  const re = new RegExp(`(?:^|\\n)${key}=.*`);
  if (re.test(content)) {
    return content.replace(re, (m) => `${m.startsWith('\n') ? '\n' : ''}${key}=${value}`);
  }
  return `${content.trimEnd()}\n${key}=${value}\n`;
}

let content = readFileSync(envPath, 'utf8');
content = upsert(content, 'CLOUDFLARE_ACCOUNT_ID', accountId);
content = upsert(content, 'CLOUDFLARE_R2_ENDPOINT', endpoint);
content = upsert(content, 'CLOUDFLARE_R2_BUCKET', bucket);
content = upsert(content, 'CLOUDFLARE_R2_ACCESS_KEY_ID', accessKeyId);
content = upsert(content, 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', secretAccessKey);
content = upsert(content, 'MEDIA_STORAGE_DRIVER', 'r2');
content = upsert(content, 'MEDIA_ALLOW_PUBLIC_READS', 'false');

writeFileSync(envPath, content, 'utf8');
console.log('R2 credentials saved to backend/.env');
console.log('MEDIA_STORAGE_DRIVER=r2');
