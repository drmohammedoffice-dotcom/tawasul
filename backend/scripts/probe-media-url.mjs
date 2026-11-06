import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

async function main() {
  const base = process.env.MEDIA_LOCAL_BASE_PATH || './storage/media';
  const mediaId = process.argv[2] || 'e22085f4c8ee4447a5df00f2';
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media) {
    console.log('not found');
    return;
  }
  const local = path.resolve(base, media.storageKey);
  console.log({
    id: media.id,
    mime: media.mimeType,
    visibility: media.visibility,
    purpose: media.purpose,
    key: media.storageKey,
    localExists: existsSync(local),
    local
  });

  // Dynamic import of built storage is heavy; just HEAD via AWS SDK if env present
  const { S3Client, HeadObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const endpoint = process.env.MEDIA_S3_ENDPOINT || process.env.R2_ENDPOINT;
  const bucket = process.env.MEDIA_S3_BUCKET || process.env.R2_BUCKET || 'securechat-media';
  const client = new S3Client({
    region: process.env.MEDIA_S3_REGION || 'auto',
    forcePathStyle: true,
    ...(endpoint ? { endpoint } : {}),
    credentials: {
      accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || ''
    }
  });
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: media.storageKey }));
    console.log('r2_head', { ok: true, size: head.ContentLength, type: head.ContentType });
  } catch (err) {
    console.log('r2_head', { ok: false, err: err instanceof Error ? err.message : String(err) });
  }
  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: media.storageKey }),
      { expiresIn: 120 }
    );
    const res = await fetch(url, { method: 'GET' });
    console.log('r2_get', { status: res.status, ct: res.headers.get('content-type'), url: url.slice(0, 100) });
  } catch (err) {
    console.log('r2_get', { err: err instanceof Error ? err.message : String(err) });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
