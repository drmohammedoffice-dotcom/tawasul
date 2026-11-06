import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3';
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

const key = `healthchecks/probe-${Date.now()}.txt`;
const body = Buffer.from(`securechat-r2-ok ${new Date().toISOString()}`);

await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'text/plain'
  })
);
console.log('PUT ok:', key);

const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
console.log('HEAD ok: size=', head.ContentLength);

const signedPut = await getSignedUrl(
  client,
  new PutObjectCommand({ Bucket: bucket, Key: `${key}.signed`, ContentType: 'text/plain' }),
  { expiresIn: 120 }
);
console.log('Presign PUT ok: url length=', signedPut.length);

const signedGet = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: bucket, Key: key }),
  { expiresIn: 120 }
);
console.log('Presign GET ok: url length=', signedGet.length);

await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
console.log('DELETE ok');
console.log('R2 OBJECT ACCESS: PASS');
