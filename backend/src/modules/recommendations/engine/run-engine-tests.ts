import assert from 'node:assert/strict';
import { validateEvent, decayWeight, normalizeSearchToken, logicalDuplicateWindowMs } from './events';
import {
  applyModel,
  BaselineRankingModel,
  distribution,
  exclusionReason,
  growthScore,
  orderStoryIds,
  pageByCursor,
  rankCandidates,
  RankingRegistry,
  rerank,
  scoreCandidate
} from './rank';
import { BASELINE_VERSION, BASELINE_WEIGHTS, type RankCandidate, type ScoredCandidate } from './types';
import { resolveWeights } from './weights';

function candidate(partial: Partial<RankCandidate> & Pick<RankCandidate, 'id' | 'authorId'>): RankCandidate {
  return {
    kind: 'post',
    createdAtMs: Date.now(),
    sources: ['fresh'],
    tags: [],
    primaryTag: null,
    captionTokens: [],
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    impressionCount: 0,
    qualifiedViewCount: 0,
    completeCount: 0,
    replayCount: 0,
    negativeCount: 0,
    recentEngagement: 0,
    previousEngagement: 0,
    following: false,
    closeFriend: false,
    sameCountry: false,
    authorAgeDays: 100,
    authorImpressionCount: 100,
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

function scored(id: string, authorId: string, total: number, extra?: Partial<ScoredCandidate>): ScoredCandidate {
  const base = candidate({ id, authorId, primaryTag: extra?.primaryTag ?? null, kind: extra?.kind ?? 'post' });
  return {
    candidate: base,
    parts: {
      interest: 0,
      freshness: 0,
      relationship: 0,
      engagement: 0,
      quality: 0,
      negative: 0,
      exploration: extra?.parts?.exploration ?? 0,
      trending: 0,
      total
    },
    total,
    id,
    authorId,
    kind: extra?.kind ?? 'post',
    primaryTag: extra?.primaryTag ?? null
  };
}

const now = Date.parse('2026-10-29T12:00:00Z');

assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', privateAuthor: true }), 'explore'), 'excluded_private');
assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', privateAuthor: true, following: true }), 'explore'), null);
assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', blocked: true, following: true }), 'feed'), 'excluded_block');
assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', hidden: true }), 'feed'), 'excluded_hidden');
assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', viewerReported: true }), 'explore'), 'excluded_report');
assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', deleted: true }), 'feed'), 'excluded_deleted');
assert.equal(
  exclusionReason(
    candidate({
      id: 's1',
      authorId: 'a',
      kind: 'story',
      storyAudience: 'close_friends',
      following: true,
      viewerIsCloseFriend: false
    }),
    'stories'
  ),
  'excluded_audience'
);
assert.equal(exclusionReason(candidate({ id: 'p1', authorId: 'a', stubMedia: true, hasPlayableMedia: false }), 'explore'), 'excluded_stub_media');

const fresh = scoreCandidate(
  candidate({ id: 'new', authorId: 'a', createdAtMs: now - 60 * 60 * 1000, tags: ['sports'], sources: ['interest'] }),
  { topics: { sports: 2 }, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  'feed'
);
const stale = scoreCandidate(
  candidate({ id: 'old', authorId: 'a', createdAtMs: now - 10 * 24 * 60 * 60 * 1000, tags: ['sports'], sources: ['interest'] }),
  { topics: { sports: 2 }, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  'feed'
);
assert.ok(fresh.total > stale.total, 'newer matching content ranks above stale content');

const cold = scoreCandidate(
  candidate({ id: 'cold', authorId: 'a', tags: ['sports'], captionTokens: ['sports'] }),
  { topics: { sports: 2 }, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  'explore'
);
const unrelated = scoreCandidate(
  candidate({ id: 'other', authorId: 'b', tags: ['zzz'] }),
  { topics: { sports: 2 }, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  'explore'
);
assert.ok(cold.interest > unrelated.interest, 'declared interest beats an unrelated topic on a cold start');

const rising = scoreCandidate(
  candidate({ id: 'rise', authorId: 'a', recentEngagement: 20, previousEngagement: 4, impressionCount: 30, viewCount: 10 }),
  { topics: {}, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  'explore'
);
const popularFlat = scoreCandidate(
  candidate({
    id: 'flat',
    authorId: 'b',
    recentEngagement: 50,
    previousEngagement: 50,
    impressionCount: 40,
    viewCount: 100000,
    likeCount: 1000
  }),
  { topics: {}, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  'explore'
);
assert.ok(rising.trending > 0 && popularFlat.trending === 0, 'flat popularity is not treated as growth');

const crowded = [
  ...Array.from({ length: 8 }, (_, i) => scored(`a${i}`, 'author-a', 100 - i)),
  ...Array.from({ length: 4 }, (_, i) => scored(`b${i}`, 'author-b', 70 - i)),
  ...Array.from({ length: 4 }, (_, i) => scored(`c${i}`, 'author-c', 60 - i))
];
const diverse = rerank(crowded, BASELINE_WEIGHTS);
const headAuthors = diverse.slice(0, 6).map((row) => row.authorId);
assert.ok(new Set(headAuthors).size >= 2, 'one account does not occupy the head when alternatives exist');
assert.ok(headAuthors.filter((id) => id === 'author-a').length <= BASELINE_WEIGHTS.maxPerAuthor);

const explorePool = [
  scored('plain', 'author-z', 90),
  ...Array.from({ length: 6 }, (_, i) => scored(`n${i}`, 'author-n', 80 - i)),
  scored('newacc', 'author-new', 10, { parts: { exploration: 0.6, interest: 0, freshness: 0, relationship: 0, engagement: 0, quality: 0, negative: 0, trending: 0, total: 10 } })
];
const withExplore = rerank(explorePool, BASELINE_WEIGHTS);
assert.ok(withExplore.findIndex((row) => row.id === 'newacc') < 8, 'eligible new content gets a discovery slot');

const vector = { topics: { sports: 2 }, hashtags: { sports: 1 }, authors: {} };
const ranked = rankCandidates(
  [
    candidate({ id: 'keep', authorId: 'a', tags: ['sports'], primaryTag: 'sports', hasPlayableMedia: true }),
    candidate({ id: 'secret', authorId: 'b', privateAuthor: true, tags: ['sports'], primaryTag: 'sports' }),
    candidate({ id: 'gone', authorId: 'c', deleted: true })
  ],
  vector,
  BASELINE_WEIGHTS,
  now,
  'explore',
  new BaselineRankingModel(BASELINE_VERSION)
);
assert.deepEqual(ranked.ranked.map((row) => row.id), ['keep']);
assert.ok((ranked.excluded.excluded_private ?? 0) >= 1);
assert.ok((ranked.excluded.excluded_deleted ?? 0) >= 1);

const page1 = pageByCursor(
  ranked.ranked.map((row) => ({ id: row.id })),
  undefined,
  1
);
const again = pageByCursor(
  ranked.ranked.map((row) => ({ id: row.id })),
  undefined,
  1
);
assert.deepEqual(page1, again, 'pagination is stable for the same ranking');

const stories = orderStoryIds(
  [
    candidate({
      id: 'mine',
      authorId: 'me',
      kind: 'story',
      self: true,
      following: true,
      hasPlayableMedia: true,
      createdAtMs: now - 1000,
      storyAudience: 'everyone'
    }),
    candidate({
      id: 'close',
      authorId: 'friend',
      kind: 'story',
      following: true,
      viewerIsCloseFriend: true,
      closeFriend: true,
      hasPlayableMedia: true,
      createdAtMs: now - 5000,
      storyAudience: 'close_friends'
    }),
    candidate({
      id: 'old',
      authorId: 'other',
      kind: 'story',
      following: true,
      seen: true,
      hasPlayableMedia: true,
      createdAtMs: now - 20 * 60 * 60 * 1000,
      storyAudience: 'everyone'
    })
  ],
  { topics: {}, hashtags: {}, authors: {} },
  BASELINE_WEIGHTS,
  now,
  new BaselineRankingModel(BASELINE_VERSION)
);
assert.equal(stories[0], 'mine');
assert.ok(stories.indexOf('close') < stories.indexOf('old'));

assert.equal(validateEvent({ eventId: 'short', eventType: 'impression', contentType: 'post', contentId: 'post_1' }, now).ok, false);
const badDwell = validateEvent(
  {
    eventId: 'event_ok_1',
    eventType: 'qualified_view',
    contentType: 'post',
    contentId: 'post_1234',
    dwellMs: 100
  },
  now
);
assert.equal(badDwell.ok, false);
if (!badDwell.ok) assert.equal(badDwell.reason, 'dwell_too_short');
const absurd = validateEvent(
  {
    eventId: 'event_ok_2',
    eventType: 'qualified_view',
    contentType: 'reel',
    contentId: 'reel_1234',
    dwellMs: 9_000_000
  },
  now
);
assert.equal(absurd.ok, false);
const progress = validateEvent(
  {
    eventId: 'event_ok_3',
    eventType: 'video_progress',
    contentType: 'reel',
    contentId: 'reel_1234',
    dwellMs: 4000,
    progress: 1.4
  },
  now
);
assert.equal(progress.ok, false);
const phone = normalizeSearchToken('user@mail.com');
assert.equal(phone, null);
assert.equal(normalizeSearchToken('07801234567'), null);
assert.equal(normalizeSearchToken('sports'), 'sports');
assert.ok(logicalDuplicateWindowMs('impression'));
assert.ok(decayWeight(2, 21, 21) < 1.1 && decayWeight(2, 21, 21) > 0.9);

const registry = new RankingRegistry(BASELINE_VERSION);
assert.equal(registry.current().version, BASELINE_VERSION);
const parts = fresh;
const abstain = applyModel({ version: 'ml-none', score: () => null }, candidate({ id: 'x', authorId: 'a' }), parts);
assert.equal(abstain, parts.total);

const resolved = resolveWeights({ interest: 1.2, notAWeight: 5, qualifiedViewMs: 10 });
assert.equal(resolved.weights.interest, 1.2);
assert.ok(resolved.rejectedKeys.includes('notAWeight'));
assert.ok(resolved.rejectedKeys.includes('qualifiedViewMs'));
assert.equal(resolved.weights.qualifiedViewMs, BASELINE_WEIGHTS.qualifiedViewMs);
assert.equal(growthScore(2, 0), 0, 'growth needs a real distinct-user floor');
assert.ok(growthScore(6, 2) > 0);

const perfStarted = Date.now();
const many = Array.from({ length: 5000 }, (_, i) =>
  candidate({
    id: `c${i}`,
    authorId: `author-${i % 400}`,
    createdAtMs: now - (i % 200) * 60 * 60 * 1000,
    tags: ['sports', 'news'].slice(0, (i % 2) + 1),
    primaryTag: i % 2 === 0 ? 'sports' : 'news',
    impressionCount: i % 50,
    likeCount: i % 7,
    viewCount: i
  })
);
const perf = rankCandidates(
  many,
  { topics: { sports: 2 }, hashtags: { news: 1 }, authors: {} },
  { ...BASELINE_WEIGHTS, candidatePool: 5000 },
  now,
  'feed',
  new BaselineRankingModel(BASELINE_VERSION)
);
const perfMs = Date.now() - perfStarted;
assert.equal(perf.ranked.length > 0, true);
assert.ok(perfMs < 1500, `5000 candidate rank took ${perfMs}ms`);
const dist = distribution(perf.ranked.slice(0, 30).map((row) => ({ authorId: row.authorId, kind: row.kind, primaryTag: row.primaryTag })));
assert.ok(dist.uniqueAuthors > 1);
const headCounts = new Map<string, number>();
for (const row of perf.ranked.slice(0, 12)) {
  headCounts.set(row.authorId, (headCounts.get(row.authorId) ?? 0) + 1);
}
assert.ok([...headCounts.values()].every((count) => count <= BASELINE_WEIGHTS.maxPerAuthor));
console.log(JSON.stringify({ ok: true, perfMs, rankedSample: dist, version: BASELINE_VERSION }));
