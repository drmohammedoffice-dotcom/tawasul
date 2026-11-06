/**
 * Verifies Cloudflare R2 credentials from backend/.env without printing secrets.
 * Usage: node scripts/check-cloudflare-r2.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'backend', '.env');

function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${filePath}`);
  }
  const map = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    map[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return map;
}

function mask(value) {
  if (!value) return '(empty)';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}…${value.slice(-2)} (len=${value.length})`;
}

const env = loadEnv(envPath);
const accountId = (env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const bucket = (env.CLOUDFLARE_R2_BUCKET || '').trim();
const accessKeyId = (env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim();
const secretAccessKey = (env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '').trim();
const endpoint =
  (env.CLOUDFLARE_R2_ENDPOINT || '').trim() ||
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

console.log('Cloudflare R2 connection check');
console.log('- MEDIA_STORAGE_DRIVER:', env.MEDIA_STORAGE_DRIVER || '(unset)');
console.log('- Account ID:', mask(accountId));
console.log('- Bucket:', bucket || '(empty)');
console.log('- Access Key ID:', mask(accessKeyId));
console.log('- Secret Access Key:', secretAccessKey ? `set (len=${secretAccessKey.length})` : '(empty)');
console.log('- Endpoint:', endpoint || '(empty)');

const missing = [];
if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
if (!bucket) missing.push('CLOUDFLARE_R2_BUCKET');
if (!accessKeyId) missing.push('CLOUDFLARE_R2_ACCESS_KEY_ID');
if (!secretAccessKey) missing.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
if (!endpoint) missing.push('CLOUDFLARE_R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID');

if (missing.length) {
  console.error('\nFAIL: missing required keys:', missing.join(', '));
  console.error('Fill backend/.env then re-run this script.');
  process.exit(2);
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: false,
  credentials: { accessKeyId, secretAccessKey }
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })
  );
  console.log('\nOK: Connected to Cloudflare R2 bucket successfully.');
  console.log('- Objects visible in listing probe:', listed.KeyCount ?? 0);
  console.log('- Dedup: clients send contentHash (SHA-256); matching files skip re-upload (instant).');
  if ((env.MEDIA_STORAGE_DRIVER || '').toLowerCase() !== 'r2') {
    console.log('\nNOTE: Set MEDIA_STORAGE_DRIVER=r2 in backend/.env to use R2 at runtime.');
  }
  const ttl = Number(env.MEDIA_SIGNED_URL_TTL_SECONDS || 0);
  if (!ttl || ttl < 300) {
    console.log('NOTE: Consider MEDIA_SIGNED_URL_TTL_SECONDS=600 for comfortable presigned PUT window.');
  }
  process.exit(0);
} catch (error) {
  console.error('\nFAIL: Could not reach R2.');
  console.error('- Error name:', error?.name || 'Error');
  console.error('- Message:', error?.message || String(error));
  process.exit(1);
}
