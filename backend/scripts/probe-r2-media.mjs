import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const prisma = new PrismaClient();

async function main() {
  const mediaId = process.argv[2];
  if (!mediaId) throw new Error('mediaId required');
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error('not found');
  const base = process.env.MEDIA_LOCAL_BASE_PATH || './storage/media';
  const local = path.resolve(base, media.storageKey);
  console.log({
    id: media.id,
    mime: media.mimeType,
    purpose: media.purpose,
    visibility: media.visibility,
    localExists: existsSync(local),
    key: media.storageKey
  });

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const client = new S3Client({
    region: 'auto',
    forcePathStyle: true,
    endpoint,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || ''
    }
  });
  console.log({ endpoint, bucket });
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: media.storageKey }));
    console.log('head_ok', { size: head.ContentLength, type: head.ContentType });
  } catch (err) {
    console.log('head_fail', err instanceof Error ? err.name + ': ' + err.message : String(err));
  }
  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: media.storageKey }),
      { expiresIn: 120 }
    );
    const res = await fetch(url);
    console.log('get', { status: res.status, ct: res.headers.get('content-type') });
  } catch (err) {
    console.log('get_fail', err instanceof Error ? err.message : String(err));
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
