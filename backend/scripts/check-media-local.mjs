import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

async function main() {
  const base =
    process.env.MEDIA_LOCAL_BASE_PATH ||
    process.env.MEDIA_LOCAL_PATH ||
    path.resolve('storage/media');
  console.log('base', base);

  const posts = await prisma.post.findMany({
    where: {
      author: { username: 'mmm' },
      deletedAt: null,
      moderationStatus: { in: ['APPROVED', 'RESTORED'] }
    },
    take: 8,
    orderBy: { createdAt: 'desc' },
    include: { media: { include: { media: true }, take: 1 } }
  });

  for (const post of posts) {
    const m = post.media[0]?.media;
    if (!m) {
      console.log({ post: post.id.slice(0, 8), status: post.moderationStatus, media: null });
      continue;
    }
    const full = path.resolve(base, m.storageKey);
    console.log({
      post: post.id.slice(0, 8),
      status: post.moderationStatus,
      mediaId: m.id,
      mime: m.mimeType,
      key: m.storageKey.slice(0, 90),
      localExists: existsSync(full)
    });
  }

  // Also check recent media assets for mmm
  const user = await prisma.user.findFirst({ where: { username: 'mmm' }, select: { id: true } });
  if (user) {
    const assets = await prisma.mediaAsset.findMany({
      where: { uploaderId: user.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, storageKey: true, mimeType: true, purpose: true }
    });
    for (const a of assets) {
      console.log({
        asset: a.id,
        purpose: a.purpose,
        mime: a.mimeType,
        localExists: existsSync(path.resolve(base, a.storageKey)),
        key: a.storageKey.slice(0, 90)
      });
    }
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
