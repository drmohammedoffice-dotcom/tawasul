import { config } from 'dotenv';
import { resolve } from 'path';
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  BASELINE_VERSION,
  BASELINE_WEIGHTS,
  type InterestVector,
  type RankCandidate
} from './engine/types';
import { BaselineRankingModel, exclusionReason, rankCandidates } from './engine/rank';

config({ path: resolve(__dirname, '../../../.env') });

const API = process.env.STAB_API || 'http://127.0.0.1:3000/api';
const PASSWORD = 'StabilTest1';
const keep = process.env.STAB_KEEP === '1';

type Check = { name: string; ok: boolean; detail: string };

function cand(
  partial: Partial<RankCandidate> & Pick<RankCandidate, 'id' | 'authorId' | 'primaryTag'>
): RankCandidate {
  return {
    kind: 'post',
    createdAtMs: Date.now() - 3_600_000,
    sources: ['interest'],
    tags: partial.primaryTag ? [partial.primaryTag] : [],
    captionTokens: [],
    viewCount: 12,
    likeCount: 1,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    impressionCount: 40,
    qualifiedViewCount: 6,
    completeCount: 1,
    replayCount: 0,
    negativeCount: 0,
    recentEngagement: 3,
    previousEngagement: 2,
    following: false,
    closeFriend: false,
    sameCountry: true,
    authorAgeDays: 120,
    authorImpressionCount: 80,
    hasPlayableMedia: true,
    stubMedia: false,
    privateAuthor: false,
    blocked: false,
    viewerReported: false,
    hidden: false,
    deleted: false,
    expired: false,
    archived: false,
    seen: false,
    storyAudience: 'n/a',
    viewerIsCloseFriend: false,
    self: false,
    ...partial
  };
}

function dcg(rels: number[]) {
  return rels.reduce((sum, rel, index) => sum + rel / Math.log2(index + 2), 0);
}

function ndcgAt(ids: string[], relevant: Set<string>, k: number) {
  const rels = ids.slice(0, k).map((id) => (relevant.has(id) ? 1 : 0));
  const ideal = Array.from({ length: Math.min(k, relevant.size) }, () => 1);
  const idealScore = dcg(ideal);
  return idealScore === 0 ? 0 : dcg(rels) / idealScore;
}

function precisionAt(ids: string[], relevant: Set<string>, k: number) {
  const slice = ids.slice(0, k);
  if (!slice.length) return 0;
  return slice.filter((id) => relevant.has(id)).length / slice.length;
}

function summarize(ids: string[], rows: RankCandidate[], k: number) {
  const top = ids.slice(0, k);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const authors = top.map((id) => byId.get(id)?.authorId || '');
  const ages = top.map((id) => (Date.now() - (byId.get(id)?.createdAtMs || Date.now())) / 3_600_000);
  const counts = new Map<string, number>();
  for (const author of authors) counts.set(author, (counts.get(author) || 0) + 1);
  return {
    uniqueAuthors: new Set(authors).size,
    maxPerAuthor: Math.max(0, ...counts.values()),
    meanAgeHours: ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0,
    tags: top.map((id) => byId.get(id)?.primaryTag || '')
  };
}

function legacyOrder(rows: RankCandidate[]) {
  const visible = rows.filter((row) => !exclusionReason(row, 'explore'));
  return visible
    .map((row) => {
      const ageH = (Date.now() - row.createdAtMs) / 3_600_000;
      const today = ageH < 24 ? 50 : 0;
      return { id: row.id, score: row.viewCount * 2 + row.likeCount * 5 + row.commentCount * 3 + today };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((row) => row.id);
}

async function api(path: string, token: string | null, method = 'GET', body?: unknown) {
  const started = Date.now();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let json: { success?: boolean; data?: unknown; message?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    json = { message: text.slice(0, 180) };
  }
  return { status: response.status, json, ms: Date.now() - started };
}

async function main() {
  const prisma = new PrismaClient();
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const stamp = Date.now().toString(36);
  const names = {
    sports: `zzstaba${stamp}`,
    food: `zzstabb${stamp}`,
    admin: `zzstabc${stamp}`,
    big: `zzstabd${stamp}`,
    small: `zzstabe${stamp}`,
    priv: `zzstabf${stamp}`,
    blocked: `zzstabg${stamp}`
  };
  const ids: string[] = [];
  const postIds: string[] = [];
  const mediaIds: string[] = [];
  const storyIds: string[] = [];
  const reelIds: string[] = [];
  let tagId = '';
  const report: Record<string, unknown> = { stamp, users: names, baseline: BASELINE_VERSION };

  try {
    if (process.env.STAB_CLEAN_ONLY === '1') {
      await cleanup(prisma);
      console.log(JSON.stringify({ cleaned: true }));
      return;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const oldAccount = new Date(Date.now() - 400 * 86_400_000);
    const newAccount = new Date(Date.now() - 2 * 86_400_000);
    const [sports, food, admin, big, small, priv, blocked] = await Promise.all([
      prisma.user.create({
        data: {
          username: names.sports,
          passwordHash,
          displayName: 'Sports viewer',
          countryCode: 'IQ',
          isAutomatedTest: true
        }
      }),
      prisma.user.create({
        data: {
          username: names.food,
          passwordHash,
          displayName: 'Food viewer',
          countryCode: 'IQ',
          isAutomatedTest: true
        }
      }),
      prisma.user.create({
        data: {
          username: names.admin,
          passwordHash,
          displayName: 'Stab admin',
          role: 'admin',
          countryCode: 'IQ',
          isAutomatedTest: true
        }
      }),
      prisma.user.create({
        data: {
          username: names.big,
          passwordHash,
          displayName: 'Big author',
          countryCode: 'IQ',
          createdAt: oldAccount,
          isAutomatedTest: true
        }
      }),
      prisma.user.create({
        data: {
          username: names.small,
          passwordHash,
          displayName: 'Small author',
          countryCode: 'IQ',
          createdAt: newAccount,
          isAutomatedTest: true
        }
      }),
      prisma.user.create({
        data: {
          username: names.priv,
          passwordHash,
          displayName: 'Private',
          isPrivate: true,
          countryCode: 'IQ',
          isAutomatedTest: true
        }
      }),
      prisma.user.create({
        data: {
          username: names.blocked,
          passwordHash,
          displayName: 'Blocked',
          countryCode: 'IQ',
          isAutomatedTest: true
        }
      })
    ]);
    ids.push(sports.id, food.id, admin.id, big.id, small.id, priv.id, blocked.id);
    await prisma.userInterest.createMany({
      data: [
        { userId: sports.id, interestKey: 'sports' },
        { userId: food.id, interestKey: 'food' }
      ]
    });
    await prisma.follow.createMany({
      data: [
        { followerId: sports.id, followingId: big.id, status: 'accepted' },
        { followerId: sports.id, followingId: small.id, status: 'accepted' },
        { followerId: sports.id, followingId: food.id, status: 'accepted' }
      ]
    });
    await prisma.userBlock.create({ data: { blockerId: sports.id, blockedId: blocked.id } });
    await prisma.closeFriend.create({ data: { ownerId: big.id, friendId: sports.id } });

    const tag = `zzstab${stamp}`.slice(0, 32);
    const hashtag = await prisma.hashtag.upsert({ where: { tag }, create: { tag }, update: {} });
    tagId = hashtag.id;

    async function media(ownerId: string) {
      const row = await prisma.mediaAsset.create({
        data: {
          uploaderId: ownerId,
          storageProvider: 'test',
          storageKey: `stab/${ownerId}/${stamp}`,
          originalFileName: 'clip.mp4',
          mimeType: 'video/mp4',
          mediaType: 'video',
          sizeBytes: 120_000,
          encryptedFileKey: 'stab',
          processingStatus: 'ready',
          uploadCompletedAt: new Date()
        }
      });
      mediaIds.push(row.id);
      return row;
    }

    const [bigMedia, smallMedia, privMedia, blockedMedia, foodMedia] = await Promise.all([
      media(big.id),
      media(small.id),
      media(priv.id),
      media(blocked.id),
      media(food.id)
    ]);
    const sportsPost = await prisma.post.create({
      data: {
        authorId: big.id,
        caption: 'sports session',
        viewCount: 4,
        media: { create: [{ mediaId: bigMedia.id, sortOrder: 0 }] },
        hashtags: { create: [{ hashtagId: hashtag.id }] }
      }
    });
    const smallPost = await prisma.post.create({
      data: {
        authorId: small.id,
        caption: 'sports new account',
        viewCount: 1,
        media: { create: [{ mediaId: smallMedia.id, sortOrder: 0 }] },
        hashtags: { create: [{ hashtagId: hashtag.id }] }
      }
    });
    const privatePost = await prisma.post.create({
      data: {
        authorId: priv.id,
        caption: 'sports private',
        media: { create: [{ mediaId: privMedia.id, sortOrder: 0 }] },
        hashtags: { create: [{ hashtagId: hashtag.id }] }
      }
    });
    const blockedPost = await prisma.post.create({
      data: {
        authorId: blocked.id,
        caption: 'sports blocked',
        media: { create: [{ mediaId: blockedMedia.id, sortOrder: 0 }] },
        hashtags: { create: [{ hashtagId: hashtag.id }] }
      }
    });
    const deletedPost = await prisma.post.create({
      data: {
        authorId: big.id,
        caption: 'sports deleted',
        deletedAt: new Date(),
        media: { create: [{ mediaId: bigMedia.id, sortOrder: 0 }] },
        hashtags: { create: [{ hashtagId: hashtag.id }] }
      }
    });
    const foodPost = await prisma.post.create({
      data: {
        authorId: food.id,
        caption: 'food plate',
        viewCount: 80,
        media: { create: [{ mediaId: foodMedia.id, sortOrder: 0 }] }
      }
    });
    postIds.push(sportsPost.id, smallPost.id, privatePost.id, blockedPost.id, deletedPost.id, foodPost.id);

    const reel = await prisma.reel.create({
      data: {
        authorId: big.id,
        mediaId: bigMedia.id,
        caption: 'sports reel',
        viewCount: 3
      }
    });
    reelIds.push(reel.id);
    const openStory = await prisma.story.create({
      data: {
        authorId: big.id,
        mediaId: bigMedia.id,
        audience: 'everyone',
        expiresAt: new Date(Date.now() + 20 * 3_600_000)
      }
    });
    const closeStory = await prisma.story.create({
      data: {
        authorId: big.id,
        mediaId: smallMedia.id,
        audience: 'close_friends',
        expiresAt: new Date(Date.now() + 20 * 3_600_000)
      }
    });
    storyIds.push(openStory.id, closeStory.id);

    const now = Date.now();
    const labeled: RankCandidate[] = [];
    const relevant = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const id = `rel${i}`;
      relevant.add(id);
      labeled.push(
        cand({
          id,
          authorId: `author${i % 6}`,
          primaryTag: 'sports',
          likeCount: 2,
          viewCount: 8,
          createdAtMs: now - (i + 1) * 3_600_000,
          authorAgeDays: i % 2 === 0 ? 4 : 200,
          authorImpressionCount: i % 2 === 0 ? 3 : 90,
          following: i % 3 === 0
        })
      );
    }
    for (let i = 0; i < 8; i += 1) {
      labeled.push(
        cand({
          id: `food${i}`,
          authorId: `viral${i % 2}`,
          primaryTag: 'food',
          likeCount: 400 + i * 20,
          viewCount: 8000,
          commentCount: 40,
          createdAtMs: now - 2 * 3_600_000,
          recentEngagement: 200,
          previousEngagement: 180
        })
      );
    }
    labeled.push(
      cand({ id: 'bad-private', authorId: 'p', primaryTag: 'sports', privateAuthor: true }),
      cand({ id: 'bad-block', authorId: 'b', primaryTag: 'sports', blocked: true }),
      cand({ id: 'bad-deleted', authorId: 'd', primaryTag: 'sports', deleted: true }),
      cand({ id: 'bad-hidden', authorId: 'h', primaryTag: 'sports', hidden: true })
    );
    const vector: InterestVector = { topics: { sports: 2 }, hashtags: {}, authors: {} };
    const model = new BaselineRankingModel(BASELINE_VERSION);
    const beforeHeap = process.memoryUsage().heapUsed;
    const started = Date.now();
    const baselineRank = rankCandidates(labeled, vector, BASELINE_WEIGHTS, now, 'explore', model);
    const baselineMs = Date.now() - started;
    const afterHeap = process.memoryUsage().heapUsed;
    const altWeights = { ...BASELINE_WEIGHTS, freshness: 2.2, engagement: 0.2 };
    const altRank = rankCandidates(labeled, vector, altWeights, now, 'explore', model);
    const cold = rankCandidates(labeled, { topics: {}, hashtags: {}, authors: {} }, BASELINE_WEIGHTS, now, 'explore', model);
    const legacyIds = legacyOrder(labeled);
    const baseIds = baselineRank.ranked.map((row) => row.id);
    const altIds = altRank.ranked.map((row) => row.id);
    const coldIds = cold.ranked.map((row) => row.id);
    const excludedExpected = 4;
    const excludedGot = Object.values(baselineRank.excluded).reduce((sum, n) => sum + n, 0);
    const k = 10;
    report.offline = {
      labeled: labeled.length,
      relevant: relevant.size,
      baselineMs,
      heapDeltaBytes: afterHeap - beforeHeap,
      exclusionRate: excludedGot / excludedExpected,
      excluded: baselineRank.excluded,
      baseline: {
        precisionAt10: precisionAt(baseIds, relevant, k),
        ndcgAt10: ndcgAt(baseIds, relevant, k),
        ...summarize(baseIds, labeled, k)
      },
      freshnessAlt: {
        precisionAt10: precisionAt(altIds, relevant, k),
        ndcgAt10: ndcgAt(altIds, relevant, k),
        ...summarize(altIds, labeled, k)
      },
      coldStart: {
        precisionAt10: precisionAt(coldIds, relevant, k),
        ndcgAt10: ndcgAt(coldIds, relevant, k),
        ...summarize(coldIds, labeled, k)
      },
      legacy: {
        precisionAt10: precisionAt(legacyIds, relevant, k),
        ndcgAt10: ndcgAt(legacyIds, relevant, k)
      }
    };
    const bigPool: RankCandidate[] = [];
    for (let i = 0; i < 5000; i += 1) {
      bigPool.push(
        cand({
          id: `p${i}`,
          authorId: `a${i % 400}`,
          primaryTag: i % 5 === 0 ? 'sports' : 'news',
          createdAtMs: now - (i % 72) * 3_600_000
        })
      );
    }
    const heapBefore = process.memoryUsage().heapUsed;
    const perfStart = Date.now();
    rankCandidates(bigPool, vector, BASELINE_WEIGHTS, now, 'explore', model);
    report.perf = {
      candidates: 5000,
      ms: Date.now() - perfStart,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore
    };

    const loginSports = await api('/auth/login', null, 'POST', {
      identifier: names.sports,
      password: PASSWORD,
      deviceId: 'stab-sports'
    });
    const loginFood = await api('/auth/login', null, 'POST', {
      identifier: names.food,
      password: PASSWORD,
      deviceId: 'stab-food'
    });
    const loginAdmin = await api('/auth/login', null, 'POST', {
      identifier: names.admin,
      password: PASSWORD,
      deviceId: 'stab-admin'
    });
    const token = (loginSports.json.data as { accessToken?: string } | undefined)?.accessToken || '';
    const foodToken = (loginFood.json.data as { accessToken?: string } | undefined)?.accessToken || '';
    const adminToken = (loginAdmin.json.data as { accessToken?: string } | undefined)?.accessToken || '';
    check('login sports', loginSports.status < 300 && Boolean(token), `status ${loginSports.status}`);
    check('login second account', loginFood.status < 300 && Boolean(foodToken), `status ${loginFood.status}`);
    check('login admin', loginAdmin.status < 300 && Boolean(adminToken), `status ${loginAdmin.status}`);

    const prefs = await api('/recommendations/preferences', token);
    check('preferences readable', prefs.status === 200, `status ${prefs.status}`);
    const chrono = await api('/recommendations/preferences', token, 'PUT', {
      feedMode: 'following_chronological'
    });
    const chronoFeed = await api('/feed?limit=20', token);
    const personalized = await api('/recommendations/preferences', token, 'PUT', { feedMode: 'personalized' });
    const personalFeed = await api('/feed?limit=20', token);
    const chronoBody = JSON.stringify(chronoFeed.json.data ?? {});
    const personalBody = JSON.stringify(personalFeed.json.data ?? {});
    check('chronological mode saved', chrono.status === 200, `status ${chrono.status}`);
    check('personalized mode saved', personalized.status === 200, `status ${personalized.status}`);
    check(
      'chronological feed has no recommendation cursor',
      chronoFeed.status === 200 && !chronoBody.includes('recommendationCursor'),
      `status ${chronoFeed.status}`
    );
    check(
      'personalized feed marks ranked items',
      personalFeed.status === 200 && personalBody.includes('recommendationSource'),
      `status ${personalFeed.status} len ${personalBody.length}`
    );
    check('personalized feed includes the followed sports post', personalBody.includes(sportsPost.id), 'feed payload');

    const explore = await api('/explore?limit=50', token);
    const exploreBody = JSON.stringify(explore.json.data ?? {});
    check('explore responds', explore.status === 200, `${explore.status} in ${explore.ms}ms`);
    check('private post excluded', !exploreBody.includes(privatePost.id), 'explore payload');
    check('blocked post excluded', !exploreBody.includes(blockedPost.id), 'explore payload');
    check('deleted post excluded', !exploreBody.includes(deletedPost.id), 'explore payload');
    const foodExplore = await api('/explore?limit=50', foodToken);
    check(
      'second account also excludes the private post',
      foodExplore.status === 200 && !JSON.stringify(foodExplore.json.data ?? {}).includes(privatePost.id),
      `status ${foodExplore.status}`
    );

    const stories = await api('/stories/feed', token);
    const storiesBody = JSON.stringify(stories.json.data ?? {});
    const strangerStories = await api('/stories/feed', foodToken);
    const strangerBody = JSON.stringify(strangerStories.json.data ?? {});
    check('close friend sees both stories', storiesBody.includes(openStory.id) && storiesBody.includes(closeStory.id), storiesBody.slice(0, 120));
    check('stranger does not see close-friends story', !strangerBody.includes(closeStory.id), 'food account feed');

    const reels = await api('/reels/feed?limit=20', token);
    check('reels feed responds', reels.status === 200, `${reels.status} in ${reels.ms}ms`);
    check('reels feed includes the followed reel', JSON.stringify(reels.json.data ?? {}).includes(reel.id), 'reel id');
    await prisma.user.update({ where: { id: big.id }, data: { isAutomatedTest: false } });
    const hashtagFeed = await api(`/hashtags/${tag}`, token);
    await prisma.user.update({ where: { id: big.id }, data: { isAutomatedTest: true } });
    const hashtagBody = JSON.stringify(hashtagFeed.json.data ?? {});
    check('hashtag feed responds', hashtagFeed.status === 200, `${hashtagFeed.status}`);
    check('hashtag feed includes the public sports post', hashtagBody.includes(sportsPost.id), 'hashtag payload');
    check(
      'hashtag feed excludes private, blocked, and deleted posts',
      !hashtagBody.includes(privatePost.id) && !hashtagBody.includes(blockedPost.id) && !hashtagBody.includes(deletedPost.id),
      'hashtag payload'
    );
    const people = await api('/recommendations/people', token);
    const trending = await api('/recommendations/trending', token);
    check('people suggestions', people.status === 200, `${people.status} in ${people.ms}ms`);
    check('trending', trending.status === 200, `${trending.status}`);
    const peopleBody = JSON.stringify(people.json.data ?? {});
    check('people payload has no score field', !/"score"/.test(peopleBody), 'public suggestion fields');

    const explain = await api(`/recommendations/explain/post/${sportsPost.id}`, token);
    const explainText = JSON.stringify(explain.json);
    check('explain ok', explain.status === 200, explainText.slice(0, 180));
    check(
      'explain hides numeric scores',
      !/"total":|"parts":|"weight":/.test(explainText),
      explainText.slice(0, 180)
    );
    const hiddenExplain = await api(`/recommendations/explain/post/${privatePost.id}`, foodToken);
    const hiddenText = JSON.stringify(hiddenExplain.json.data ?? {});
    check(
      'ineligible explain does not say why',
      hiddenExplain.status === 200 && hiddenText.includes('"eligible":false') && !/private|block|hidden/.test(hiddenText),
      hiddenText
    );

    const weightsBefore = await weightSum(prisma, sports.id);
    const shortView = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}short01`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed',
          dwellMs: 400
        }
      ]
    });
    const hugeView = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}huge0001`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed',
          dwellMs: 500_000
        }
      ]
    });
    const phoneSearch = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}phone001`,
          eventType: 'search_query',
          query: '07701234567',
          surface: 'search'
        }
      ]
    });
    const messageEvent = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}msg00001`,
          eventType: 'qualified_view',
          contentType: 'message',
          contentId: 'secretmessage',
          surface: 'feed',
          dwellMs: 3000
        }
      ]
    });
    const weightsAfterReject = await weightSum(prisma, sports.id);
    check('short dwell rejected', JSON.stringify(shortView.json).includes('dwell_too_short'), JSON.stringify(shortView.json).slice(0, 240));
    check('huge dwell rejected', JSON.stringify(hugeView.json).includes('dwell_out_of_range'), JSON.stringify(hugeView.json).slice(0, 240));
    check('phone search rejected', JSON.stringify(phoneSearch.json).includes('empty_query'), JSON.stringify(phoneSearch.json).slice(0, 240));
    check('message content rejected by the API', messageEvent.status === 400, `status ${messageEvent.status}`);
    check('rejected events do not change weights', weightsBefore === weightsAfterReject, `${weightsBefore} -> ${weightsAfterReject}`);

    const impression = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}imp0001`,
          eventType: 'impression',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed'
        }
      ]
    });
    const qualified = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}qv00001`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed',
          dwellMs: 2400
        }
      ]
    });
    const weightsAfterView = await weightSum(prisma, sports.id);
    const duplicate = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}qv00001`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed',
          dwellMs: 2400
        },
        {
          eventId: `stab${stamp}qv00002`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed',
          dwellMs: 2600
        }
      ]
    });
    const weightsAfterDup = await weightSum(prisma, sports.id);
    const noContext = await api('/recommendations/events', token, 'POST', {
      events: [
        {
          eventId: `stab${stamp}qvnocxt1`,
          eventType: 'qualified_view',
          contentType: 'post',
          contentId: smallPost.id,
          surface: 'feed',
          dwellMs: 2500
        }
      ]
    });
    check('impression accepted', JSON.stringify(impression.json.data).includes('accepted'), JSON.stringify(impression.json.data));
    check('qualified view accepted once', JSON.stringify(qualified.json.data).includes('accepted'), JSON.stringify(qualified.json.data));
    check('qualified view increases weight once', weightsAfterView > weightsAfterReject, `${weightsAfterReject} -> ${weightsAfterView}`);
    check(
      'duplicate event and window do not increase weight',
      weightsAfterDup === weightsAfterView && JSON.stringify(duplicate.json.data).includes('duplicate'),
      JSON.stringify(duplicate.json.data)
    );
    check('view without impression rejected', JSON.stringify(noContext.json.data).includes('no_impression_context'), JSON.stringify(noContext.json.data));
    const stored = await prisma.recommendationEvent.findFirst({
      where: { userId: sports.id, eventType: 'qualified_view', contentId: sportsPost.id }
    });
    check('stored dwell is the clamped millisecond value', stored?.value === 2400, `value ${stored?.value}`);
    const viewRows = await prisma.recommendationEvent.count({
      where: { userId: sports.id, eventType: 'qualified_view', contentId: sportsPost.id }
    });
    check('one qualified view row', viewRows === 1, `rows ${viewRows}`);

    check(
      'followed posts are in the personalized feed before hiding',
      personalBody.includes(foodPost.id) && personalBody.includes(smallPost.id),
      'feed before signal'
    );
    const signal = await api('/content/signals', token, 'POST', {
      targetType: 'post',
      targetId: foodPost.id,
      signal: 'not_interested'
    });
    const mute = await api('/recommendations/mute', token, 'POST', {
      targetType: 'author',
      targetId: small.id
    });
    const afterHide = await api('/feed?limit=30', token);
    const afterBody = JSON.stringify(afterHide.json.data ?? {});
    check('not interested accepted', signal.status < 300, `status ${signal.status}`);
    check('mute accepted', mute.status < 300, `status ${mute.status}`);
    check('hidden food post leaves the personalized feed', !afterBody.includes(foodPost.id), 'feed after signal');
    check('muted author leaves the personalized feed', !afterBody.includes(smallPost.id), 'feed after mute');
    const weightsAfterSignal = await weightSum(prisma, sports.id);

    const adminDenied = await api('/recommendations/admin/overview', token);
    const adminOk = await api('/recommendations/admin/overview', adminToken);
    const adminPut = await api('/recommendations/admin/config', token, 'PUT', { weights: { interest: 3 } });
    const badWeights = await api('/recommendations/admin/config', adminToken, 'PUT', {
      weights: { interest: 99, notAWeight: 1 }
    });
    const still = await api('/recommendations/admin/overview', adminToken);
    const overview = (adminOk.json.data || {}) as { version?: string; trainedModel?: boolean; metricsScope?: string };
    const stillOverview = (still.json.data || {}) as { version?: string };
    check('member cannot open admin', adminDenied.status === 403, `status ${adminDenied.status}`);
    check('member cannot publish weights', adminPut.status === 403, `status ${adminPut.status}`);
    check('admin overview', adminOk.status === 200 && overview.trainedModel === false, JSON.stringify(overview).slice(0, 220));
    check('invalid weights do not publish', badWeights.status === 400, `status ${badWeights.status}`);
    check('active version stays baseline', stillOverview.version === BASELINE_VERSION, stillOverview.version || '');
    report.admin = {
      version: overview.version,
      trainedModel: overview.trainedModel,
      metricsScope: overview.metricsScope ?? null
    };

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'RecommendationDailyStat'
    `;
    const columnNames = columns.map((row) => row.column_name);
    check('daily stats have no user id', !columnNames.some((name) => /user/i.test(name)), columnNames.join(','));
    const statSample = await prisma.recommendationDailyStat.findFirst({
      where: { eventType: 'qualified_view', outcome: 'rejected', reason: 'dwell_too_short' },
      select: { day: true, eventType: true, outcome: true, reason: true, count: true }
    });
    report.dailyStat = statSample;
    check('rejection reason is aggregated without a user id', Boolean(statSample && statSample.count > 0), JSON.stringify(statSample));

    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    const preexisting = await prisma.recommendationEvent.count({ where: { createdAt: { lt: cutoff } } });
    if (preexisting > 0) {
      report.prune = { ran: false, preexisting };
      check('prune skipped to protect older rows', true, `preexisting ${preexisting}`);
    } else {
      const oldEvent = await prisma.recommendationEvent.create({
        data: {
          eventId: `stab${stamp}old0001`,
          userId: sports.id,
          eventType: 'impression',
          contentType: 'post',
          contentId: sportsPost.id,
          surface: 'feed',
          createdAt: new Date(Date.now() - 100 * 86_400_000)
        }
      });
      const { RecommendationEventsService } = await import('./events.service');
      const { InterestProfileService } = await import('./interest-profile.service');
      const interests = new InterestProfileService(prisma as never);
      const redisStub = {
        getClient() {
          return {
            async incr() {
              return 1;
            },
            async expire() {
              return 1;
            }
          };
        }
      };
      const events = new RecommendationEventsService(prisma as never, redisStub as never, interests);
      const removed = await events.prune(90, 500);
      const gone = await prisma.recommendationEvent.findUnique({ where: { id: oldEvent.id } });
      const recentLeft = await prisma.recommendationEvent.count({ where: { userId: sports.id, eventType: 'qualified_view' } });
      report.prune = { ran: true, removed, gone: !gone, recentQualifiedLeft: recentLeft };
      check('prune deletes only the old row', !gone && recentLeft === 1 && removed >= 1, JSON.stringify(report.prune));
    }

    let accepted = 0;
    let limited = 0;
    for (let batch = 0; batch < 6; batch += 1) {
      const events = Array.from({ length: 25 }, (_, index) => ({
        eventId: `stab${stamp}r${batch}${index}`.slice(0, 40),
        eventType: 'impression',
        contentType: 'post',
        contentId: sportsPost.id,
        surface: 'feed'
      }));
      const burst = await api('/recommendations/events', token, 'POST', { events });
      const body = JSON.stringify(burst.json.data ?? {});
      accepted += (body.match(/accepted/g) || []).length;
      limited += (body.match(/rate_limited/g) || []).length;
    }
    const weightsAfterBurst = await weightSum(prisma, sports.id);
    report.rateLimit = { accepted, limited, weightsUnchanged: weightsAfterBurst === weightsAfterSignal };
    check('rate limit rejects the overflow', limited > 0, `accepted ${accepted} limited ${limited}`);
    check(
      'rate-limited impressions do not change weights',
      weightsAfterBurst === weightsAfterSignal,
      `${weightsAfterSignal} -> ${weightsAfterBurst}`
    );

    const declaredBefore = await prisma.userInterest.count({ where: { userId: sports.id } });
    const reset = await api('/recommendations/reset', token, 'POST');
    const declaredAfter = await prisma.userInterest.count({ where: { userId: sports.id } });
    const eventsAfter = await prisma.recommendationEvent.count({ where: { userId: sports.id } });
    const mutesAfter = await prisma.recommendationMute.count({ where: { userId: sports.id } });
    check('reset clears events and mutes', reset.status < 300 && eventsAfter === 0 && mutesAfter === 0, `status ${reset.status} events ${eventsAfter} mutes ${mutesAfter}`);
    check('reset keeps declared interests', declaredBefore === declaredAfter && declaredAfter === 1, `${declaredBefore} -> ${declaredAfter}`);

    const throwingRedis = {
      getClient() {
        throw new Error('redis down');
      }
    };
    const { RecommendationEventsService } = await import('./events.service');
    const { InterestProfileService } = await import('./interest-profile.service');
    const probeInterests = new InterestProfileService(prisma as never);
    const firstLimiter = new RecommendationEventsService(prisma as never, throwingRedis as never, probeInterests);
    const secondLimiter = new RecommendationEventsService(prisma as never, throwingRedis as never, probeInterests);
    const probe = (service: object) =>
      service as unknown as { allowRate(userId: string, maxPerMinute: number): Promise<boolean> };
    const memoryUser = `mem${stamp}`;
    const first = await probe(firstLimiter).allowRate(memoryUser, 2);
    const second = await probe(firstLimiter).allowRate(memoryUser, 2);
    const third = await probe(firstLimiter).allowRate(memoryUser, 2);
    const otherProcess = await probe(secondLimiter).allowRate(memoryUser, 2);
    report.redisFallback = {
      sameProcess: [first, second, third],
      otherProcessFirstCall: otherProcess,
      shared: false
    };
    check(
      'redis fallback limits inside one process',
      first && second && !third,
      JSON.stringify(report.redisFallback)
    );
    check(
      'a second process does not share the in-process counter',
      otherProcess === true,
      'second instance allowed the first call'
    );

    report.checks = checks;
    report.failed = checks.filter((row) => !row.ok).length;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!keep && process.env.STAB_CLEAN_ONLY !== '1') await cleanup(prisma, ids, postIds, mediaIds, storyIds, reelIds, tagId);
    await prisma.$disconnect();
  }
}

async function weightSum(prisma: PrismaClient, userId: string) {
  const rows = await prisma.userInterestWeight.findMany({ where: { userId }, select: { weight: true } });
  return rows.reduce((sum, row) => sum + row.weight, 0);
}

async function cleanup(
  prisma: PrismaClient,
  ids: string[] = [],
  postIds: string[] = [],
  mediaIds: string[] = [],
  storyIds: string[] = [],
  reelIds: string[] = [],
  tagId = ''
) {
  const users = ids.length
    ? ids
    : (
        await prisma.user.findMany({
          where: { username: { startsWith: 'zzstab' } },
          select: { id: true }
        })
      ).map((row) => row.id);
  if (!users.length && !postIds.length) return;
  await prisma.recommendationEvent.deleteMany({ where: { userId: { in: users } } });
  await prisma.recommendationMute.deleteMany({ where: { userId: { in: users } } });
  await prisma.userInterestWeight.deleteMany({ where: { userId: { in: users } } });
  await prisma.recommendationPreference.deleteMany({ where: { userId: { in: users } } });
  await prisma.userInterest.deleteMany({ where: { userId: { in: users } } });
  await prisma.storyView.deleteMany({ where: { OR: [{ viewerId: { in: users } }, { storyId: { in: storyIds } }] } });
  await prisma.story.deleteMany({ where: { OR: [{ authorId: { in: users } }, { id: { in: storyIds } }] } });
  await prisma.reel.deleteMany({ where: { OR: [{ authorId: { in: users } }, { id: { in: reelIds } }] } });
  await prisma.post.deleteMany({ where: { OR: [{ authorId: { in: users } }, { id: { in: postIds } }] } });
  await prisma.follow.deleteMany({
    where: { OR: [{ followerId: { in: users } }, { followingId: { in: users } }] }
  });
  await prisma.userBlock.deleteMany({
    where: { OR: [{ blockerId: { in: users } }, { blockedId: { in: users } }] }
  });
  await prisma.closeFriend.deleteMany({
    where: { OR: [{ ownerId: { in: users } }, { friendId: { in: users } }] }
  });
  await prisma.mediaAsset.deleteMany({ where: { OR: [{ uploaderId: { in: users } }, { id: { in: mediaIds } }] } });
  if (tagId) {
    const left = await prisma.postHashtag.count({ where: { hashtagId: tagId } });
    if (left === 0) await prisma.hashtag.deleteMany({ where: { id: tagId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
