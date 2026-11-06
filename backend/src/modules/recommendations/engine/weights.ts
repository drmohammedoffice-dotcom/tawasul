import { BASELINE_VERSION, BASELINE_WEIGHTS, type RankWeights } from './types';

const RANGES: Record<keyof RankWeights, [number, number]> = {
  interest: [0, 3],
  freshness: [0, 3],
  relationship: [0, 3],
  engagement: [0, 3],
  quality: [0, 3],
  negative: [0, 3],
  exploration: [0, 3],
  trending: [0, 3],
  interestHalfLifeDays: [1, 180],
  qualifiedViewMs: [500, 30_000],
  videoCompleteRatio: [0.5, 1],
  maxWatchMs: [5_000, 600_000],
  eventRetentionDays: [7, 365],
  maxEventsPerBatch: [1, 25],
  rateLimitPerMinute: [10, 600],
  maxPerAuthor: [1, 6],
  kindWindow: [2, 20],
  maxSameKindInWindow: [1, 10],
  tagWindow: [2, 20],
  maxSameTagInWindow: [1, 10],
  exploreEvery: [0, 20],
  candidatePool: [20, 200],
  pageCacheTtlSeconds: [5, 300]
};

export function resolveWeights(stored: unknown): { weights: RankWeights; rejectedKeys: string[] } {
  const weights: RankWeights = { ...BASELINE_WEIGHTS };
  const rejectedKeys: string[] = [];
  if (!stored || typeof stored !== 'object') return { weights, rejectedKeys };
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!(key in RANGES)) {
      rejectedKeys.push(key);
      continue;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    const range = RANGES[key as keyof RankWeights];
    if (!Number.isFinite(numeric) || numeric < range[0] || numeric > range[1]) {
      rejectedKeys.push(key);
      continue;
    }
    weights[key as keyof RankWeights] = numeric;
  }
  return { weights, rejectedKeys };
}

export function baselineDocument() {
  return {
    version: BASELINE_VERSION,
    trained: false,
    description:
      'SecureChat baseline-1.0.0. Hand-set, versioned weights for a deterministic scorer. Not copied from another product and not fit from engagement logs.',
    weights: BASELINE_WEIGHTS
  };
}
