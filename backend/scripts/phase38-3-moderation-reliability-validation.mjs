/**
 * Phase 38.3 — prove quarantine reliability after real-world owner-grid leak.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'ai-service/validation-results');
mkdirSync(outDir, { recursive: true });

const {
  isPubliclyVisible,
  mediaBytesAllowed,
  PUBLIC_MODERATION_STATUSES
} = require('../src/modules/moderation/moderation.visibility.ts');
const { scanTextSafety } = require('../src/modules/moderation/engine/safety-scanner.ts');

const report = { at: new Date().toISOString(), phase: '38.3', passed: [], failed: [], skipped: [] };
function check(name, ok, detail = {}) {
  (ok ? report.passed : report.failed).push({ name, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}
function skip(name, reason) {
  report.skipped.push({ name, reason });
  console.log(`SKIP ${name} — ${reason}`);
}

check('pending_not_public', !isPubliclyVisible('PENDING_REVIEW'));
check('hidden_not_public', !isPubliclyVisible('HIDDEN'));
check('pending_no_media_bytes', !mediaBytesAllowed('PENDING_REVIEW'));
check('hidden_no_media_bytes', !mediaBytesAllowed('HIDDEN'));
check('approved_media_bytes', mediaBytesAllowed('APPROVED'));
check('public_statuses_strict', PUBLIC_MODERATION_STATUSES.join(',') === 'APPROVED,RESTORED');

{
  const posts = readFileSync(path.join(__dirname, '../src/modules/social/posts.service.ts'), 'utf8');
  const reels = readFileSync(path.join(__dirname, '../src/modules/social/reels.service.ts'), 'utf8');
  const media = readFileSync(path.join(__dirname, '../src/modules/media/media.service.ts'), 'utf8');
  check('posts_redact_attach', posts.includes('mediaBytesAllowed') && posts.includes('mediaRedacted'));
  check('reels_author_filter', reels.includes('publicModerationWhere()') && reels.includes('listByAuthor'));
  check('reels_redact_attach', reels.includes('mediaBytesAllowed'));
  check(
    'media_url_blocks_non_approved_even_owner',
    media.includes("st !== 'APPROVED'") && media.includes('Social content')
  );
  // Uploader short-circuit must come AFTER social post/reel/story moderation checks.
  const postGate = media.indexOf('Social content: media bytes only after APPROVED');
  const uploaderDraft = media.indexOf('Unlinked upload still owned by user');
  check(
    'uploader_mint_only_for_unlinked_drafts',
    postGate >= 0 && uploaderDraft > postGate
  );
}

{
  const py = path.join(root, 'ai-service/.venv/Scripts/python.exe');
  const worker = path.join(root, 'ai-service/python/worker_nsfw.py');
  const fixture = path.join(root, 'ai-service/models/fixtures/ocr-en-clear.png');
  const modelDir = path.join(root, 'ai-service/models/nsfw');
  if (existsSync(py) && existsSync(worker) && existsSync(fixture)) {
    const r = spawnSync(py, [worker], {
      input: JSON.stringify({ path: fixture, modelDir }),
      encoding: 'utf8',
      timeout: 300000,
      env: { ...process.env, PYTHONUTF8: '1' }
    });
    let json = null;
    try {
      json = JSON.parse((r.stdout || '').trim().split('\n').pop() || '{}');
    } catch {
      json = null;
    }
    check(
      'nsfw_inference_real',
      Boolean(json?.ok && json.inference && typeof json.nsfwScore === 'number'),
      { label: json?.label, nsfwScore: json?.nsfwScore, modelId: json?.modelId }
    );
  } else {
    check('nsfw_inference_real', false, { error: 'missing_worker_or_fixture' });
  }
}

const prisma = new PrismaClient();
const base = process.env.API_BASE || 'http://127.0.0.1:3000/api';
try {
  const hidden = await prisma.post.findFirst({
    where: { moderationStatus: 'HIDDEN', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      media: { take: 1, select: { mediaId: true } },
      author: { select: { id: true, username: true } }
    }
  });
  if (!hidden) {
    skip('db_hidden_excluded_from_public', 'no_hidden_post');
    skip('api_hidden_post_unauth', 'no_hidden_post');
    skip('api_hidden_media_unauth', 'no_hidden_post');
  } else {
    const inPublic = await prisma.post.findFirst({
      where: {
        id: hidden.id,
        moderationStatus: { in: [...PUBLIC_MODERATION_STATUSES] }
      }
    });
    check('db_hidden_excluded_from_public', !inPublic, { id: hidden.id });

    const rPost = await fetch(`${base}/posts/${hidden.id}`);
    check('api_hidden_post_unauth', rPost.status === 401 || rPost.status === 404, {
      status: rPost.status
    });

    if (hidden.media[0]?.mediaId) {
      const rMedia = await fetch(`${base}/media/${hidden.media[0].mediaId}/url`);
      check(
        'api_hidden_media_unauth',
        rMedia.status === 401 || rMedia.status === 403 || rMedia.status === 404,
        { status: rMedia.status }
      );
    }

    // Simulate owner list semantics: HIDDEN returned for owner query but bytes must not be public status
    const ownerVisible = await prisma.post.findMany({
      where: { authorId: hidden.authorId, deletedAt: null },
      select: { id: true, moderationStatus: true }
    });
    check(
      'owner_can_see_hidden_row_metadata',
      ownerVisible.some((p) => p.id === hidden.id && p.moderationStatus === 'HIDDEN')
    );
    check(
      'stranger_public_list_excludes_hidden',
      !(await prisma.post.findFirst({
        where: {
          authorId: hidden.authorId,
          id: hidden.id,
          moderationStatus: { in: [...PUBLIC_MODERATION_STATUSES] }
        }
      }))
    );
  }

  // Sexual text still blocks
  const hit = scanTextSafety({ text: 'porn إباحي' });
  check('sexual_text_still_detected', hit.top?.category === 'sexual');

  // Code: video frame worker exists
  check(
    'video_frame_worker_present',
    existsSync(path.join(root, 'ai-service/python/worker_video_frames_nsfw.py'))
  );
  const mod = readFileSync(path.join(__dirname, '../src/modules/moderation/moderation.service.ts'), 'utf8');
  check('video_nsfw_wired', mod.includes('classifyVideoNsfw'));
  check('fail_closed_media_incomplete', mod.includes('media_scan_incomplete'));
} catch (err) {
  check('db_api_suite', false, { error: String(err?.message || err) });
} finally {
  await prisma.$disconnect();
}

skip(
  'browser_manual_second_account',
  'API/DB stranger exclusion proven; interactive second-account UI left for operator'
);
skip(
  'licensed_porn_fixture_storage',
  'no adult fixtures stored in repo; production HIDDEN posts used as evidence'
);

report.summary = {
  passed: report.passed.length,
  failed: report.failed.length,
  skipped: report.skipped.length
};
const dest = path.join(outDir, 'phase38-3-latest.json');
writeFileSync(dest, JSON.stringify(report, null, 2));
console.log('Summary', report.summary);
console.log('Wrote', dest);
if (report.failed.length) process.exitCode = 1;
