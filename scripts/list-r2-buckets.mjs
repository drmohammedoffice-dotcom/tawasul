import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, ListBucketsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/.env');
function loadEnv(filePath) {
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
const env = loadEnv(envPath);
const endpoint =
  (env.CLOUDFLARE_R2_ENDPOINT || '').trim() ||
  `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const client = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: false,
  credentials: {
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY.trim()
  }
});

try {
  const out = await client.send(new ListBucketsCommand({}));
  const names = (out.Buckets || []).map((b) => b.Name);
  console.log('Buckets:', names.length ? names.join(', ') : '(none)');
  for (const name of names.slice(0, 5)) {
    try {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }));
      console.log(`- ${name}: accessible (keys=${listed.KeyCount ?? 0})`);
    } catch (e) {
      console.log(`- ${name}: list failed (${e.name})`);
    }
  }
} catch (e) {
  console.error('ListBuckets failed:', e.name, e.message);
  process.exit(1);
}
