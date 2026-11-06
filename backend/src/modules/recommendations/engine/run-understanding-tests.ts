import assert from 'node:assert/strict';
import { decayWeight, validateEvent } from './events';
import { BaselineRankingModel, emptyInterest, exclusionReason, rankCandidates } from './rank';
import { estimateEngagement } from './predict';
import { rankStaged } from './stages';
import { analyzeText, contentHash, LEXICON_VERSION } from './taxonomy';
import { BASELINE_VERSION, BASELINE_WEIGHTS, type RankCandidate } from './types';

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

const arabic = analyzeText('سيارة كهربائية جديدة بتكنولوجيا حديثة');
assert.equal(arabic.language, 'ar');
assert.equal(arabic.modelVersion, LEXICON_VERSION);
assert.ok(arabic.topics.some((topic) => topic.key === 'electric_cars'));
assert.ok(arabic.topics.some((topic) => topic.key === 'cars'));
assert.ok(arabic.topics.some((topic) => topic.key === 'technology'));
assert.ok(arabic.topics.filter((topic) => topic.confidence >= 0.4).length >= 2);

const english = analyzeText('football match and sports news');
assert.equal(english.language, 'en');
assert.ok(english.topics.some((topic) => topic.key === 'football'));
assert.ok(english.topics.some((topic) => topic.key === 'sports'));

const mixed = analyzeText('سفر travel إلى بغداد');
assert.equal(mixed.language, 'mixed');
assert.ok(mixed.topics.some((topic) => topic.key === 'travel'));

const misspelled = analyzeText('تكنلوجيا و سياره');
assert.ok(misspelled.topics.some((topic) => topic.key === 'technology'));
assert.ok(misspelled.topics.some((topic) => topic.key === 'cars'));

const low = analyzeText('ا');
assert.equal(low.quality, 'low');
assert.equal(low.topics.length, 0);

const noisy = analyzeText('aaaaaaaaaaaa');
assert.equal(noisy.quality, 'low');

const hashA = contentHash('سيارة كهربائية', ['tech']);
const hashB = contentHash('سيارة كهربائية', ['tech']);
const hashC = contentHash('سيارة كهربائية جديدة', ['tech']);
assert.equal(hashA, hashB);
assert.notEqual(hashA, hashC);

const fresh = decayWeight(2, 0, 21);
const old = decayWeight(2, 21, 21);
assert.ok(old < fresh);
assert.ok(Math.abs(old - 1) < 0.05);

const casual = 0.35 * 0.4;
const sustained = 0.35;
assert.ok(casual < sustained);

const now = Date.now();
const vector = emptyInterest();
vector.topics.technology = 4;
const plain = candidate({ id: 'plain', authorId: 'a1', tags: ['cars'], primaryTag: 'cars' });
const understood = candidate({
  id: 'ev',
  authorId: 'a2',
  tags: ['cars', 'technology', 'electric_cars'],
  primaryTag: 'cars'
});
const ranked = rankCandidates([plain, understood], vector, BASELINE_WEIGHTS, now, 'explore', new BaselineRankingModel(BASELINE_VERSION));
assert.equal(ranked.ranked[0]?.id, 'ev');

const hidden = candidate({ id: 'gone', authorId: 'a3', deleted: true });
const blocked = candidate({ id: 'blocked', authorId: 'a4', blocked: true });
const privatePost = candidate({ id: 'priv', authorId: 'a5', privateAuthor: true });
assert.equal(exclusionReason(hidden, 'feed'), 'excluded_deleted');
assert.equal(exclusionReason(blocked, 'feed'), 'excluded_block');
assert.equal(exclusionReason(privatePost, 'explore'), 'excluded_private');

const staged = rankStaged([hidden, understood], vector, BASELINE_WEIGHTS, now, 'explore', new BaselineRankingModel(BASELINE_VERSION), {
  multiStage: true,
  engagementHints: true
});
assert.equal(staged.ranked.some((row) => row.id === 'gone'), false);
assert.equal(staged.ranked[0]?.id, 'ev');

const estimate = estimateEngagement({ interest: 0.8, freshness: 0.7, relationship: 0.4, quality: 0.6, negative: 0.1 });
assert.equal(estimate.trained, false);
assert.ok(estimate.watch > estimate.comment);
assert.ok(estimate.notInterested < 1);

const baselineOnly = rankCandidates([plain, understood], vector, BASELINE_WEIGHTS, now, 'feed', new BaselineRankingModel(BASELINE_VERSION));
assert.equal(baselineOnly.ranked.length, 2);

const skip = validateEvent(
  {
    eventId: 'skipreel1',
    eventType: 'video_skip',
    contentType: 'reel',
    contentId: 'reel1',
    dwellMs: 400
  },
  now
);
assert.equal(skip.ok, true);
const notSkip = validateEvent(
  {
    eventId: 'skipreel2',
    eventType: 'video_skip',
    contentType: 'reel',
    contentId: 'reel1',
    dwellMs: 5000
  },
  now
);
assert.equal(notSkip.ok, false);

console.log(JSON.stringify({ ok: true, lexicon: LEXICON_VERSION, topics: arabic.topics.map((topic) => topic.key) }));
