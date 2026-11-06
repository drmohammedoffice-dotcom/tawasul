import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
const bucket = env.CLOUDFLARE_R2_BUCKET.trim();
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

const key = `healthchecks/cors-probe-${Date.now()}.bin`;
const signedUrl = await getSignedUrl(
  client,
  new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'application/octet-stream' }),
  { expiresIn: 120 }
);

const origin = 'http://localhost:5173';
const optionsRes = await fetch(signedUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-type'
  }
});

const allowOrigin = optionsRes.headers.get('access-control-allow-origin');
const allowMethods = optionsRes.headers.get('access-control-allow-methods');

console.log('OPTIONS status:', optionsRes.status);
console.log('ACA-Origin:', allowOrigin || '(missing)');
console.log('ACA-Methods:', allowMethods || '(missing)');

if (optionsRes.ok && allowOrigin && (allowOrigin === '*' || allowOrigin === origin)) {
  console.log('CORS: PASS');
  process.exit(0);
}

console.log('CORS: FAIL or incomplete — re-check bucket CORS JSON in Cloudflare dashboard');
process.exit(1);
