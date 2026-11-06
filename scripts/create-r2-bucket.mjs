import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand
} from '@aws-sdk/client-s3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'backend', '.env');

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
const bucket = (env.CLOUDFLARE_R2_BUCKET || 'securechat-media').trim();
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
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`Bucket already exists: ${bucket}`);
} catch {
  console.log(`Creating bucket: ${bucket}`);
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log('Bucket created.');
}

const corsPath = path.join(root, 'infrastructure', 'cloudflare', 'r2-cors.json');
if (existsSync(corsPath)) {
  try {
    const corsRules = JSON.parse(readFileSync(corsPath, 'utf8'));
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: corsRules }
      })
    );
    console.log('CORS applied from infrastructure/cloudflare/r2-cors.json');
  } catch (error) {
    console.log(
      'CORS API apply skipped (token may lack admin). Apply manually in dashboard if needed:',
      error?.name || 'Error'
    );
  }
}

console.log('DONE');
