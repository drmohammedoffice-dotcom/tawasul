import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { ContentAnalysisService } from './analysis.service';
import { RecommendationFeatureService } from './feature.service';
import { InterestProfileService } from './interest-profile.service';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const prisma = new PrismaClient();
  const stamp = Date.now().toString(36);
  const username = `zzadv${stamp}`;
  const features = new RecommendationFeatureService(prisma as never);
  const analysis = new ContentAnalysisService(prisma as never, features);
  const interests = new InterestProfileService(prisma as never);
  let userId = '';
  let postId = '';
  try {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: 'not-a-real-login',
        displayName: 'Adv fixture',
        isAutomatedTest: true,
        countryCode: 'IQ'
      }
    });
    userId = user.id;
    const post = await prisma.post.create({
      data: { authorId: user.id, caption: 'سيارة كهربائية جديدة بتكنولوجيا حديثة' }
    });
    postId = post.id;
    await analysis.enqueueAsync('post', post.id, post.caption || '', []);
    const first = await analysis.processBatch(5);
    assert.ok(first.done >= 1);
    const saved = await prisma.contentUnderstanding.findUnique({
      where: { contentType_contentId: { contentType: 'post', contentId: post.id } }
    });
    assert.ok(saved);
    assert.equal(saved.status, 'ready');
    assert.equal(saved.modelVersion, 'lexicon-1.0.0');
    const topics = Array.isArray(saved.topics) ? saved.topics : [];
    const keys = topics.map((topic) =>
      topic && typeof topic === 'object' && 'key' in topic ? String(topic.key) : ''
    );
    assert.ok(keys.includes('technology'));
    assert.ok(keys.includes('cars'));
    const before = await prisma.contentAnalysisJob.count({ where: { contentId: post.id } });
    await analysis.enqueueAsync('post', post.id, post.caption || '', []);
    const after = await prisma.contentAnalysisJob.count({ where: { contentId: post.id } });
    assert.equal(before, after);

    await interests.apply(user.id, 'qualified_view', { hashtags: keys, authorId: user.id }, 0.4);
    const weight = await prisma.userInterestWeight.findFirst({
      where: { userId: user.id, kind: 'topic', key: 'technology' }
    });
    assert.ok(weight && weight.weight > 0 && weight.weight < 0.35);

    const denied = await features.set('conversationSignals', true, 100);
    assert.equal(denied.ok, false);
    const messages = await prisma.message.count();
    assert.equal(typeof messages, 'number');

    const missingId = `missing${stamp}`;
    await prisma.contentAnalysisJob.create({
      data: { contentType: 'post', contentId: missingId, contentHash: 'a'.repeat(64), status: 'pending' }
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await prisma.contentAnalysisJob.updateMany({
        where: { contentId: missingId },
        data: { status: 'pending', runAfter: new Date(Date.now() - 1000) }
      });
      await analysis.processBatch(5);
    }
    const failed = await prisma.contentAnalysisJob.findFirst({ where: { contentId: missingId } });
    assert.equal(failed?.status, 'failed');

    await prisma.recommendationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, feedMode: 'personalized', personalizationEnabled: false },
      update: { personalizationEnabled: false }
    });
    const pref = await interests.preference(user.id);
    assert.equal(pref.personalizationEnabled, false);
    await interests.reset(user.id);
    const kept = await prisma.userInterest.count({ where: { userId: user.id } });
    assert.equal(kept, 0);
    const clearedWeights = await prisma.userInterestWeight.count({ where: { userId: user.id } });
    assert.equal(clearedWeights, 0);

    console.log(JSON.stringify({ ok: true, topics: keys, job: failed?.status, user: username }));
  } finally {
    if (postId) {
      await prisma.contentUnderstanding.deleteMany({ where: { contentId: postId } });
      await prisma.contentAnalysisJob.deleteMany({ where: { contentId: postId } });
    }
    await prisma.contentAnalysisJob.deleteMany({ where: { contentId: { startsWith: 'missing' } } });
    await prisma.contentUnderstanding.deleteMany({ where: { contentId: { startsWith: 'missing' } } });
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    const leftover = await prisma.user.count({ where: { username: { startsWith: 'zzadv' } } });
    console.log(JSON.stringify({ leftover }));
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
