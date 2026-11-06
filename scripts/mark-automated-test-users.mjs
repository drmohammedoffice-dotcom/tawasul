/**
 * Marks existing smoke/fixture accounts with isAutomatedTest=true.
 * Does NOT delete users, posts, or media.
 */
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTOMATED_USERNAME =
  /^(alice|bob|logout|priv|ga|gb|gs|rca|rcb|rcs|uxa|uxb|uxs|own|str|fol|blk1|blk2|lo|img|mem|out|chow|chmem|usera|userb|ux|uxfix|msgpeer|peer|gate|rcg|rcc|d|d2|n|g|ch|cr)_[0-9a-f]+(_\d+)?$/i;

function looksLikeAutomatedTestUsername(username) {
  const u = String(username || '').trim();
  if (!u) return false;
  if (AUTOMATED_USERNAME.test(u)) return true;
  if (/^[a-z][a-z0-9]{0,20}_\d{12,15}_\d{1,6}$/i.test(u)) return true;
  if (/^(alphaimg|alphaready|alphaqa|qaexplorer)\d{10,}$/i.test(u)) return true;
  return false;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      // Prefer backend/.env via prisma schema default when run from backend cwd.
    }
  }
});

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, isAutomatedTest: true }
  });
  let marked = 0;
  let already = 0;
  for (const u of users) {
    const should = looksLikeAutomatedTestUsername(u.username);
    if (!should) continue;
    if (u.isAutomatedTest) {
      already += 1;
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { isAutomatedTest: true }
    });
    marked += 1;
  }
  console.log(
    JSON.stringify({
      scanned: users.length,
      newlyMarked: marked,
      alreadyMarked: already,
      note: 'No rows deleted',
      script: path.basename(fileURLToPath(import.meta.url))
    })
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
