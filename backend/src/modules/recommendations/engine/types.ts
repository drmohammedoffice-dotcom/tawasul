/** Product ranking types. Weights are versioned settings, not a trained model. */

export const BASELINE_VERSION = 'baseline-1.0.0';

export const EVENT_TYPES = [
  'impression',
  'qualified_view',
  'video_start',
  'video_progress',
  'video_complete',
  'video_skip',
  'replay',
  'like',
  'unlike',
  'comment',
  'delete_comment',
  'save',
  'unsave',
  'share',
  'follow',
  'unfollow',
  'profile_visit',
  'hide_post',
  'not_interested',
  'report',
  'story_view',
  'story_complete',
  'search_query',
  'dismiss_recommendation',
  'more_like_this'
] as const;

export type RecommendationEventType = (typeof EVENT_TYPES)[number];

export const CONTENT_TYPES = ['post', 'reel', 'story', 'user', 'hashtag'] as const;
export type ContentKind = (typeof CONTENT_TYPES)[number];

export const SURFACES = ['feed', 'reels', 'stories', 'explore', 'search', 'profile', 'people'] as const;
export type Surface = (typeof SURFACES)[number] | 'hashtag';

export type CandidateSource =
  | 'following'
  | 'interest'
  | 'similar'
  | 'fresh'
  | 'trending'
  | 'new_account'
  | 'people';

export type RankWeights = {
  interest: number;
  freshness: number;
  relationship: number;
  engagement: number;
  quality: number;
  negative: number;
  exploration: number;
  trending: number;
  interestHalfLifeDays: number;
  qualifiedViewMs: number;
  videoCompleteRatio: number;
  maxWatchMs: number;
  eventRetentionDays: number;
  maxEventsPerBatch: number;
  rateLimitPerMinute: number;
  maxPerAuthor: number;
  kindWindow: number;
  maxSameKindInWindow: number;
  tagWindow: number;
  maxSameTagInWindow: number;
  exploreEvery: number;
  candidatePool: number;
  pageCacheTtlSeconds: number;
};

export const BASELINE_WEIGHTS: RankWeights = {
  interest: 1,
  freshness: 0.85,
  relationship: 0.7,
  engagement: 0.55,
  quality: 0.35,
  negative: 1.15,
  exploration: 0.4,
  trending: 0.6,
  interestHalfLifeDays: 21,
  qualifiedViewMs: 2000,
  videoCompleteRatio: 0.9,
  maxWatchMs: 180_000,
  eventRetentionDays: 90,
  maxEventsPerBatch: 25,
  rateLimitPerMinute: 120,
  maxPerAuthor: 2,
  kindWindow: 6,
  maxSameKindInWindow: 4,
  tagWindow: 8,
  maxSameTagInWindow: 3,
  exploreEvery: 7,
  candidatePool: 120,
  pageCacheTtlSeconds: 45
};

export type RankCandidate = {
  id: string;
  kind: ContentKind;
  authorId: string;
  createdAtMs: number;
  sources: CandidateSource[];
  tags: string[];
  primaryTag: string | null;
  captionTokens: string[];
  viewCount: number;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
  impressionCount: number;
  qualifiedViewCount: number;
  completeCount: number;
  replayCount: number;
  negativeCount: number;
  recentEngagement: number;
  previousEngagement: number;
  following: boolean;
  closeFriend: boolean;
  sameCountry: boolean;
  authorAgeDays: number;
  authorImpressionCount: number;
  hasPlayableMedia: boolean;
  stubMedia: boolean;
  privateAuthor: boolean;
  blocked: boolean;
  viewerReported: boolean;
  hidden: boolean;
  deleted: boolean;
  expired: boolean;
  archived: boolean;
  seen: boolean;
  storyAudience: 'everyone' | 'close_friends' | 'family' | 'n/a';
  viewerIsCloseFriend: boolean;
  self: boolean;
};

export type InterestVector = {
  topics: Record<string, number>;
  hashtags: Record<string, number>;
  authors: Record<string, number>;
};

export type ScoreParts = {
  interest: number;
  freshness: number;
  relationship: number;
  engagement: number;
  quality: number;
  negative: number;
  exploration: number;
  trending: number;
  total: number;
};

export type ScoredCandidate = {
  candidate: RankCandidate;
  parts: ScoreParts;
  total: number;
  id: string;
  authorId: string;
  kind: ContentKind;
  primaryTag: string | null;
};

export type RankSurface = 'feed' | 'reels' | 'stories' | 'explore' | 'hashtag';
