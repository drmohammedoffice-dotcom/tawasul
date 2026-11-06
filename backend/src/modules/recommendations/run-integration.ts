import { config } from 'dotenv';
import { resolve } from 'path';
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const prisma = new PrismaClient();
  const stamp = Date.now().toString(36);
  const passwordHash = 'not-a-real-login';
  const viewerName = `zzrecv${stamp}`;
  const publicName = `zzrecp${stamp}`;
  const privateName = `zzrecr${stamp}`;
  const blockedName = `zzrecb${stamp}`;
  const ids: string[] = [];
  try {
    const [viewer, author, hidden, blocked] = await Promise.all([
      prisma.user.create({
        data: { username: viewerName, passwordHash, displayName: 'Viewer', isAutomatedTest: false, countryCode: 'IQ' }
      }),
      prisma.user.create({
        data: { username: publicName, passwordHash, displayName: 'Public', isPrivate: false, countryCode: 'IQ' }
      }),
      prisma.user.create({
        data: { username: privateName, passwordHash, displayName: 'Private', isPrivate: true, countryCode: 'IQ' }
      }),
      prisma.user.create({
        data: { username: blockedName, passwordHash, displayName: 'Blocked', isPrivate: false, countryCode: 'IQ' }
      })
    ]);
    ids.push(viewer.id, author.id, hidden.id, blocked.id);
    await prisma.userInterest.create({ data: { userId: viewer.id, interestKey: 'sports' } });
    await prisma.userBlock.create({ data: { blockerId: viewer.id, blockedId: blocked.id } });

    async function media(ownerId: string) {
      return prisma.mediaAsset.create({
        data: {
          uploaderId: ownerId,
          storageProvider: 'test',
          storageKey: `rec-test/${ownerId}`,
          originalFileName: 'clip.mp4',
          mimeType: 'video/mp4',
          mediaType: 'video',
          sizeBytes: 120_000,
          encryptedFileKey: 'test',
          processingStatus: 'ready',
          uploadCompletedAt: new Date()
        }
      });
    }

    const [publicMedia, privateMedia, blockedMedia] = await Promise.all([
      media(author.id),
      media(hidden.id),
      media(blocked.id)
    ]);
    const tag = await prisma.hashtag.upsert({
      where: { tag: `sports${stamp}`.slice(0, 32) },
      create: { tag: `sports${stamp}`.slice(0, 32) },
      update: {}
    });
    const [publicPost, privatePost, blockedPost] = await Promise.all([
      prisma.post.create({
        data: {
          authorId: author.id,
          caption: 'sports training',
          media: { create: [{ mediaId: publicMedia.id, sortOrder: 0 }] },
          hashtags: { create: [{ hashtagId: tag.id }] }
        }
      }),
      prisma.post.create({
        data: {
          authorId: hidden.id,
          caption: 'sports private',
          media: { create: [{ mediaId: privateMedia.id, sortOrder: 0 }] },
          hashtags: { create: [{ hashtagId: tag.id }] }
        }
      }),
      prisma.post.create({
        data: {
          authorId: blocked.id,
          caption: 'sports blocked',
          media: { create: [{ mediaId: blockedMedia.id, sortOrder: 0 }] },
          hashtags: { create: [{ hashtagId: tag.id }] }
        }
      })
    ]);

    const { CandidateService } = await import('./candidate.service');
    const { InterestProfileService } = await import('./interest-profile.service');
    const { RecommendationConfigService } = await import('./config.service');
    const { RecommendationPlannerService } = await import('./planner.service');
    const { RecommendationEventsService } = await import('./events.service');
    const { RecommendationMetricsService } = await import('./metrics.service');

    const interests = new InterestProfileService(prisma as never);
    const candidates = new CandidateService(prisma as never, interests);
    const configs = new RecommendationConfigService(prisma as never);
    const cache = {
      async getJson() {
        return null;
      },
      async setJson() {
        return undefined;
      },
      async delByPrefix() {
        return undefined;
      }
    };
    const redis = {
      getClient() {
        return {
          incr: async () => {
            throw new Error('redis down in test');
          },
          expire: async () => 0,
          hincrby: async () => {
            throw new Error('redis down in test');
          },
          hgetall: async () => {
            throw new Error('redis down in test');
          }
        };
      }
    };
    const metrics = new RecommendationMetricsService(redis as never);
    const features = {
      async modeFor() {
        return { textAnalysis: true, hybrid: false, engagementHints: false, multiStage: false, shadow: false };
      }
    };
    const planner = new RecommendationPlannerService(
      candidates,
      interests,
      configs,
      cache as never,
      metrics,
      features as never
    );
    const events = new RecommendationEventsService(prisma as never, redis as never, interests);

    const explore = await planner.planExplore(viewer.id, undefined, 40);
    const seen = new Set(explore.items.map((item) => item.id));
    assert.equal(seen.has(publicPost.id), true, 'public eligible post is a candidate');
    assert.equal(seen.has(privatePost.id), false, 'private post is excluded before ranking');
    assert.equal(seen.has(blockedPost.id), false, 'blocked author is excluded before ranking');

    const chrono = await interests.setFeedMode(viewer.id, 'following_chronological');
    assert.equal(chrono.feedMode, 'following_chronological');
    const home = await planner.planHome(viewer.id, undefined, 10);
    assert.equal(home, null, 'chronological mode keeps the following feed path');
    await interests.setFeedMode(viewer.id, 'personalized');

    const weights = (await configs.active()).weights;
    const impressionId = `evt_${stamp}_imp`;
    const first = await events.ingest(
      viewer.id,
      [
        {
          eventId: impressionId,
          eventType: 'impression',
          contentType: 'post',
          contentId: publicPost.id,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(first.results[0]?.status, 'accepted');
    const dup = await events.ingest(
      viewer.id,
      [
        {
          eventId: impressionId,
          eventType: 'impression',
          contentType: 'post',
          contentId: publicPost.id,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(dup.results[0]?.reason, 'duplicate_event');

    const tooSoon = await events.ingest(
      viewer.id,
      [
        {
          eventId: `evt_${stamp}_qv_short`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: publicPost.id,
          dwellMs: 100,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(tooSoon.results[0]?.status, 'rejected');

    const noContext = await events.ingest(
      blocked.id,
      [
        {
          eventId: `evt_${stamp}_qv_ctx`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: publicPost.id,
          dwellMs: 2500,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(noContext.results[0]?.reason, 'no_impression_context');

    const qualified = await events.ingest(
      viewer.id,
      [
        {
          eventId: `evt_${stamp}_qv`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: publicPost.id,
          dwellMs: 2500,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(qualified.results[0]?.status, 'accepted');
    const qualifiedAgain = await events.ingest(
      viewer.id,
      [
        {
          eventId: `evt_${stamp}_qv2`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: publicPost.id,
          dwellMs: 2500,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(qualifiedAgain.results[0]?.reason, 'duplicate_window');

    const invisible = await events.ingest(
      viewer.id,
      [
        {
          eventId: `evt_${stamp}_priv`,
          eventType: 'impression',
          contentType: 'post',
          contentId: privatePost.id,
          surface: 'explore'
        }
      ],
      weights
    );
    assert.equal(invisible.results[0]?.reason, 'not_visible');

    const phoneSearch = await events.ingest(
      viewer.id,
      [{ eventId: `evt_${stamp}_q`, eventType: 'search_query', query: '07801112233', surface: 'search' }],
      weights
    );
    assert.equal(phoneSearch.results[0]?.status, 'rejected');

    await prisma.recommendationMute.create({
      data: { userId: viewer.id, targetType: 'post', targetId: publicPost.id, reason: 'hide' }
    });
    const afterHide = await planner.planExplore(viewer.id, undefined, 40);
    assert.equal(
      afterHide.items.some((item) => item.id === publicPost.id),
      false,
      'hidden post leaves the candidate set'
    );

    const pageA = await planner.planHashtag(viewer.id, tag.tag, undefined, 5);
    const pageB = await planner.planHashtag(viewer.id, tag.tag, undefined, 5);
    assert.deepEqual(
      pageA.items.map((item) => item.id),
      pageB.items.map((item) => item.id)
    );

    const explain = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN SELECT p.id FROM "Post" p
       JOIN "User" u ON u.id = p."authorId"
       WHERE p."deletedAt" IS NULL AND p."archivedAt" IS NULL
         AND u."isPrivate" = false AND u."isAutomatedTest" = false
         AND p."createdAt" > NOW() - INTERVAL '14 days'
       ORDER BY p."createdAt" DESC
       LIMIT 80`
    );
    console.log(
      JSON.stringify({
        ok: true,
        exploreCount: explore.items.length,
        explain: explain.map((row) => row['QUERY PLAN'])
      })
    );
  } finally {
    if (ids.length) {
      await prisma.recommendationEvent.deleteMany({ where: { userId: { in: ids } } });
      await prisma.recommendationMute.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userInterestWeight.deleteMany({ where: { userId: { in: ids } } });
      await prisma.recommendationPreference.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userInterest.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userBlock.deleteMany({
        where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] }
      });
      await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
      await prisma.mediaAsset.deleteMany({ where: { uploaderId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
