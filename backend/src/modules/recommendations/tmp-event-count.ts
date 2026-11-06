import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({
    where: { username: 'zzstabamvtxltj0' },
    select: { id: true }
  });
  if (!user) {
    console.log(JSON.stringify({ missing: true }));
    await prisma.$disconnect();
    return;
  }
  const rows = await prisma.recommendationEvent.findMany({
    where: { userId: user.id },
    select: { eventType: true, surface: true, value: true, contentType: true, contentId: true },
    orderBy: { createdAt: 'asc' }
  });
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.eventType] = (counts[row.eventType] || 0) + 1;
  const qualifiedValues = [...new Set(rows.filter((row) => row.eventType === 'qualified_view').map((row) => row.value))];
  const views = await prisma.storyView.count({ where: { viewerId: user.id } });
  console.log(
    JSON.stringify({
      n: rows.length,
      counts,
      qualifiedValues,
      storyViews: views,
      rows: rows.map((row) => ({
        eventType: row.eventType,
        surface: row.surface,
        contentType: row.contentType,
        value: row.value
      }))
    })
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
