import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.post.findMany({
    where: { moderationStatus: { in: ['REVIEW_FAILED', 'PENDING_REVIEW'] }, deletedAt: null },
    select: { id: true, moderationStatus: true }
  });
  const reels = await prisma.reel.findMany({
    where: { moderationStatus: { in: ['REVIEW_FAILED', 'PENDING_REVIEW'] }, deletedAt: null },
    select: { id: true, moderationStatus: true }
  });
  console.log('stuck_posts', posts.length, posts.map((p) => `${p.id}:${p.moderationStatus}`));
  console.log('stuck_reels', reels.length, reels.map((r) => `${r.id}:${r.moderationStatus}`));

  for (const row of posts) {
    await prisma.moderationJob.updateMany({
      where: { contentType: 'post', contentId: row.id },
      data: { status: 'pending', runAfter: new Date(), lastError: null, attempts: 0, priority: 90 }
    });
  }
  for (const row of reels) {
    await prisma.moderationJob.updateMany({
      where: { contentType: 'reel', contentId: row.id },
      data: { status: 'pending', runAfter: new Date(), lastError: null, attempts: 0, priority: 90 }
    });
  }
  console.log('requeued');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
