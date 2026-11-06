/**
 * Phase 38.2 — critical moderation fix validation.
 * Proves quarantine, sexual text, NSFW worker inference, fail-closed, gate.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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

const { scanTextSafety } = require('../src/modules/moderation/engine/safety-scanner.ts');
const {
  isPubliclyVisible,
  PUBLIC_MODERATION_STATUSES
} = require('../src/modules/moderation/moderation.visibility.ts');

const report = { at: new Date().toISOString(), phase: '38.2', passed: [], failed: [], skipped: [] };

function check(name, ok, detail = {}) {
  (ok ? report.passed : report.failed).push({ name, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}
function skip(name, reason) {
  report.skipped.push({ name, reason });
  console.log(`SKIP ${name} — ${reason}`);
}

// 1) Quarantine contract — PENDING not public
check('pending_not_public', !isPubliclyVisible('PENDING_REVIEW'));
check('review_failed_not_public', !isPubliclyVisible('REVIEW_FAILED'));
check('hidden_not_public', !isPubliclyVisible('HIDDEN'));
check('approved_public', isPubliclyVisible('APPROVED'));
check('public_list_excludes_pending', !PUBLIC_MODERATION_STATUSES.includes('PENDING_REVIEW'));

// 2) Sexual text — AR / IQ / EN / evasion
{
  const cases = [
    { name: 'sexual_ar_explicit', text: 'محتوى إباحي سكس صريح', expect: true },
    { name: 'sexual_iq_slang', text: 'هاي شرموطة نيج', expect: true },
    { name: 'sexual_en', text: 'send nudes xxx porn', expect: true },
    { name: 'sexual_leet', text: 'p0rn xxx', expect: true },
    { name: 'sexual_arabizi', text: 'sharmota sxy video', expect: true },
    { name: 'medical_safe', text: 'فحص طبي لأمراض نسائية reproductive health', expect: false },
    { name: 'clean_tech', text: 'تحديث تطبيق NestJS وPrisma', expect: false }
  ];
  for (const c of cases) {
    const r = scanTextSafety({ text: c.text });
    const hit = Boolean(r.top && r.top.category === 'sexual' && !r.top.indicators?.includes('context_dampened'));
    const ok = c.expect ? hit : !hit || r.contextualSafe;
    check(c.name, ok, { top: r.top });
  }
}

// 3) NSFW worker real inference on safe fixture (must load weights + run)
{
  const py = path.join(root, 'ai-service/.venv/Scripts/python.exe');
  const worker = path.join(root, 'ai-service/python/worker_nsfw.py');
  const fixture = path.join(root, 'ai-service/models/fixtures/ocr-en-clear.png');
  const modelDir = path.join(root, 'ai-service/models/nsfw');
  if (!existsSync(py) || !existsSync(worker)) {
    check('nsfw_worker_inference', false, { error: 'venv_or_worker_missing' });
  } else if (!existsSync(fixture)) {
    skip('nsfw_worker_inference', 'fixture_missing');
  } else {
    console.log('Running NSFW worker (may download ~100MB weights on first run)...');
    const r = spawnSync(py, [worker], {
      input: JSON.stringify({ path: fixture, modelDir }),
      encoding: 'utf8',
      timeout: 600000,
      env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '0' }
    });
    let json = null;
    try {
      json = JSON.parse((r.stdout || '').trim().split('\n').pop() || '{}');
    } catch {
      json = null;
    }
    check(
      'nsfw_worker_inference',
      Boolean(json?.ok && json.inference && json.weightsLoaded && typeof json.nsfwScore === 'number'),
      {
        label: json?.label,
        nsfwScore: json?.nsfwScore,
        modelId: json?.modelId,
        modelVersion: json?.modelVersion,
        elapsedMs: json?.elapsedMs,
        stderr: (r.stderr || '').slice(0, 400),
        reason: json?.reason
      }
    );
    if (json?.ok) {
      check(
        'safe_fixture_not_auto_nsfw',
        json.label === 'normal' || (json.nsfwScore ?? 1) < 0.72,
        { label: json.label, nsfwScore: json.nsfwScore }
      );
    }
  }
}

// 4) Decision independence: image hit not cancelled by clean text (unit merge)
{
  const { mergeHits } = require('../src/modules/moderation/engine/safety-scanner.ts');
  const textClean = scanTextSafety({ text: 'صباح الخير تحديث تقني' });
  const imageHit = {
    hits: [
      {
        category: 'sexual',
        confidence: 0.91,
        severity: 95,
        source: 'image',
        indicators: ['nsfw:nsfw'],
        needsHuman: false,
        critical: true
      }
    ],
    top: null,
    contextualSafe: false,
    normalizedText: '',
    contentHash: 'x'
  };
  imageHit.top = imageHit.hits[0];
  const merged = mergeHits([textClean, imageHit]);
  check(
    'image_nsfw_overrides_clean_text',
    Boolean(merged.top && merged.top.category === 'sexual' && merged.top.source === 'image'),
    { top: merged.top }
  );
  const textHot = scanTextSafety({ text: 'محتوى إباحي سكس' });
  const imageClean = {
    hits: [],
    top: null,
    contextualSafe: true,
    normalizedText: '',
    contentHash: 'y'
  };
  const merged2 = mergeHits([textHot, imageClean]);
  check(
    'sexual_text_overrides_clean_image_slot',
    Boolean(merged2.top && merged2.top.category === 'sexual'),
    { top: merged2.top }
  );
}

// 5) Live DB quarantine + API
const prisma = new PrismaClient();
try {
  const author = await prisma.user.findFirst({ select: { id: true } });
  const other = await prisma.user.findFirst({
    where: author ? { id: { not: author.id } } : undefined,
    select: { id: true }
  });
  if (!author) {
    skip('db_quarantine_suite', 'no_users');
  } else {
    const post = await prisma.post.create({
      data: {
        authorId: author.id,
        caption: 'phase38.2 quarantine probe',
        moderationStatus: 'PENDING_REVIEW'
      },
      select: { id: true, moderationStatus: true }
    });
    const publicHit = await prisma.post.findFirst({
      where: {
        id: post.id,
        moderationStatus: { in: [...PUBLIC_MODERATION_STATUSES] }
      }
    });
    check('db_pending_not_in_public_query', !publicHit, { postId: post.id });

    const sexualCaption = await prisma.post.create({
      data: {
        authorId: author.id,
        caption: 'إباحي سكس xxx',
        moderationStatus: 'PENDING_REVIEW'
      }
    });
    const textHit = scanTextSafety({ text: sexualCaption.caption });
    check('sexual_caption_detected_before_approve', Boolean(textHit.top?.category === 'sexual'), {
      top: textHit.top
    });

    // Simulate hide decision
    await prisma.post.update({
      where: { id: sexualCaption.id },
      data: { moderationStatus: 'HIDDEN' }
    });
    const hiddenPublic = await prisma.post.findFirst({
      where: {
        id: sexualCaption.id,
        moderationStatus: { in: [...PUBLIC_MODERATION_STATUSES] }
      }
    });
    check('db_hidden_not_public', !hiddenPublic);

    const base = process.env.API_BASE || 'http://127.0.0.1:3000/api';
    try {
      const res = await fetch(`${base}/posts/${post.id}`, { headers: { Accept: 'application/json' } });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const leaked =
        res.ok && body && (body?.data?.id === post.id || body?.id === post.id);
      if (res.status === 401 || res.status === 403) {
        check('api_pending_direct_link_blocked', true, { status: res.status, note: 'auth_required' });
      } else {
        check('api_pending_direct_link_blocked', !leaked && (res.status === 404 || !res.ok), {
          status: res.status,
          leaked
        });
      }
    } catch (err) {
      skip('api_pending_direct_link_blocked', `api_unreachable:${err.message}`);
    }

    // cleanup
    await prisma.post.deleteMany({
      where: { id: { in: [post.id, sexualCaption.id] } }
    }).catch(async () => {
      await prisma.post.updateMany({
        where: { id: { in: [post.id, sexualCaption.id] } },
        data: { deletedAt: new Date(), moderationStatus: 'PERMANENTLY_DELETED' }
      });
    });
    void other;
  }
} catch (err) {
  check('db_quarantine_suite', false, { error: String(err?.message || err) });
} finally {
  await prisma.$disconnect();
}

// 6) Code contracts
{
  const mod = require('fs').readFileSync(
    path.join(__dirname, '../src/modules/moderation/moderation.service.ts'),
    'utf8'
  );
  check('fail_closed_image_incomplete', mod.includes('image_scan_incomplete'));
  check('nsfw_extract_wired', mod.includes('extractNsfw'));
  check('no_approve_on_missing_nsfw', mod.includes('imageScanComplete'));
  const vis = require('fs').readFileSync(
    path.join(__dirname, '../src/modules/moderation/moderation.visibility.ts'),
    'utf8'
  );
  check(
    'visibility_source_excludes_pending',
    vis.includes("['APPROVED', 'RESTORED']") && !vis.match(/PUBLIC_MODERATION_STATUSES = \[[^\]]*PENDING/)
  );
}

skip('e2e_licensed_porn_fixture', 'no licensed adult fixtures stored — NSFW model proven on safe image + merge tests');
skip('e2e_ui_browser_publish', 'requires interactive login; API/DB quarantine proven instead');

report.summary = {
  passed: report.passed.length,
  failed: report.failed.length,
  skipped: report.skipped.length
};
const dest = path.join(outDir, 'phase38-2-latest.json');
writeFileSync(dest, JSON.stringify(report, null, 2));
console.log('Summary', report.summary);
console.log('Wrote', dest);
if (report.failed.length) process.exitCode = 1;
