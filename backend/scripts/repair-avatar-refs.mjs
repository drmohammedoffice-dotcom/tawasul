import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const users = await prisma.user.findMany({
  where: {
    OR: [
      { avatarUrl: { contains: 'local-file' } },
      { avatarUrl: { contains: 'r2.cloudflarestorage.com' } },
      { avatarUrl: { contains: 'X-Amz-' } },
      { coverUrl: { contains: 'local-file' } },
      { coverUrl: { contains: 'X-Amz-' } }
    ]
  },
  select: { id: true, username: true, avatarUrl: true, coverUrl: true }
});

function extractId(raw) {
  if (!raw) return null;
  const m =
    /media:([a-z0-9]+)/i.exec(raw) ||
    /\/api\/media\/local-file\/([a-z0-9]+)/i.exec(raw) ||
    /\/(?:avatar|cover)\/([a-z0-9]{20,})\//i.exec(raw);
  return m?.[1] || null;
}

let fixed = 0;
for (const user of users) {
  const data = {};
  const avatarId = extractId(user.avatarUrl);
  if (avatarId) {
    // Prefer newest avatar asset for this user when local-file id is stale.
    const latest = await prisma.mediaAsset.findFirst({
      where: { uploaderId: user.id, purpose: 'avatar', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    });
    data.avatarUrl = `media:${latest?.id || avatarId}`;
  }
  const coverId = extractId(user.coverUrl);
  if (coverId) data.coverUrl = `media:${coverId}`;
  if (Object.keys(data).length) {
    await prisma.user.update({ where: { id: user.id }, data });
    fixed += 1;
    console.log('fixed', user.username, data);
  }
}

// Mark avatar/cover assets public so other users can resolve them.
const pub = await prisma.mediaAsset.updateMany({
  where: { purpose: { in: ['avatar', 'cover', 'sticker'] }, visibility: 'private' },
  data: { visibility: 'public' }
});
console.log({ usersFixed: fixed, assetsMarkedPublic: pub.count });
await prisma.$disconnect();
