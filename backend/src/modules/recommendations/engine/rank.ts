import type {
  InterestVector,
  RankCandidate,
  RankSurface,
  RankWeights,
  ScoreParts,
  ScoredCandidate
} from './types';

export function emptyInterest(): InterestVector {
  return { topics: {}, hashtags: {}, authors: {} };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function exclusionReason(candidate: RankCandidate, surface: RankSurface): string | null {
  if (candidate.deleted || candidate.archived) return 'excluded_deleted';
  if (candidate.expired) return 'excluded_expired';
  if (candidate.blocked) return 'excluded_block';
  if (candidate.hidden) return 'excluded_hidden';
  if (candidate.viewerReported) return 'excluded_report';
  if (candidate.privateAuthor && !candidate.following && !candidate.self) return 'excluded_private';
  if (candidate.stubMedia && surface !== 'feed') return 'excluded_stub_media';
  if (!candidate.hasPlayableMedia && (candidate.kind === 'reel' || candidate.kind === 'story')) {
    return 'excluded_media';
  }
  if (surface !== 'feed' && !candidate.hasPlayableMedia && candidate.kind === 'post') {
    return 'excluded_media';
  }
  if (candidate.kind === 'story' && !candidate.self) {
    if (!candidate.following) return 'excluded_not_following';
    if (
      (candidate.storyAudience === 'close_friends' || candidate.storyAudience === 'family') &&
      !candidate.viewerIsCloseFriend
    ) {
      return 'excluded_audience';
    }
  }
  return null;
}

export function scoreCandidate(
  candidate: RankCandidate,
  vector: InterestVector,
  weights: RankWeights,
  nowMs: number,
  surface: RankSurface
): ScoreParts {
  let interestRaw = 0;
  let hits = 0;
  for (const tag of candidate.tags) {
    const w = (vector.hashtags[tag] ?? 0) + (vector.topics[tag] ?? 0);
    if (w > 0) {
      interestRaw += w;
      hits += 1;
    }
  }
  for (const token of candidate.captionTokens) {
    const w = vector.topics[token] ?? 0;
    if (w > 0) {
      interestRaw += w * 0.5;
      hits += 1;
    }
  }
  const authorW = vector.authors[candidate.authorId] ?? 0;
  if (authorW > 0) {
    interestRaw += authorW;
    hits += 1;
  }
  const interest = hits === 0 ? 0 : clamp01(interestRaw / (hits * 2));

  const ageHours = Math.max(0, (nowMs - candidate.createdAtMs) / 3_600_000);
  const tau = candidate.kind === 'story' ? 8 : surface === 'reels' ? 48 : 72;
  let freshness = Math.exp(-ageHours / tau);
  if (candidate.seen && candidate.kind === 'story') freshness *= 0.35;

  let relationship = 0.12;
  if (candidate.self) relationship = 0.22;
  else if (candidate.closeFriend || candidate.viewerIsCloseFriend) relationship = 1;
  else if (candidate.following) relationship = 0.82;
  else if (candidate.sameCountry) relationship = 0.28;
  if (surface === 'explore' && candidate.following && !candidate.closeFriend) relationship *= 0.35;

  const positives =
    candidate.qualifiedViewCount +
    candidate.likeCount * 2 +
    candidate.saveCount * 3 +
    candidate.shareCount * 4 +
    candidate.completeCount * 2 +
    candidate.replayCount;
  const rate = positives / Math.max(candidate.impressionCount, 1);
  const observed = clamp01(rate / 5);
  const engagement =
    candidate.impressionCount >= 20 ? observed : 0.15 * 0.5 + observed * 0.5;
  const popularityDamp =
    candidate.impressionCount >= 20 ? 0 : Math.log1p(candidate.viewCount) / Math.log1p(10_000);
  const engagementMixed = clamp01(engagement * 0.85 + popularityDamp * 0.15);

  let quality = candidate.hasPlayableMedia ? 0.7 : 0.15;
  if (candidate.stubMedia) quality = 0;
  if (candidate.negativeCount >= 3 && candidate.negativeCount > candidate.qualifiedViewCount) {
    quality *= 0.4;
  }

  let negative = Math.min(1, candidate.negativeCount / 5);
  if (authorW < 0) negative = clamp01(negative + Math.min(1, -authorW / 3));

  let exploration = 0;
  if (
    candidate.authorAgeDays <= 30 &&
    candidate.authorImpressionCount < 40 &&
    candidate.hasPlayableMedia &&
    !candidate.stubMedia &&
    !candidate.self
  ) {
    exploration = 0.7 * (1 - candidate.authorImpressionCount / 40);
  } else if (ageHours < 36 && candidate.impressionCount < 25 && !candidate.self) {
    exploration = 0.45;
  }

  const recent = Math.max(0, candidate.recentEngagement);
  const previous = Math.max(0, candidate.previousEngagement);
  let trending = 0;
  if (recent + previous >= 5 && recent > previous) {
    trending = clamp01((recent - previous) / Math.max(previous, 1) / 2);
  }

  const total =
    weights.interest * interest +
    weights.freshness * freshness +
    weights.relationship * relationship +
    weights.engagement * engagementMixed +
    weights.quality * quality +
    weights.exploration * exploration +
    weights.trending * trending -
    weights.negative * negative;

  return {
    interest,
    freshness,
    relationship,
    engagement: engagementMixed,
    quality,
    negative,
    exploration,
    trending,
    total
  };
}

export type RankingModel = {
  readonly version: string;
  score(input: { candidate: RankCandidate; parts: ScoreParts }): number | null;
};

export class BaselineRankingModel implements RankingModel {
  readonly version: string;
  constructor(version: string) {
    this.version = version;
  }
  score(input: { candidate: RankCandidate; parts: ScoreParts }): number {
    return input.parts.total;
  }
}

export class RankingRegistry {
  private model: RankingModel;
  constructor(version: string) {
    this.model = new BaselineRankingModel(version);
  }
  use(model: RankingModel) {
    this.model = model;
  }
  current(): RankingModel {
    return this.model;
  }
}

export function applyModel(model: RankingModel, candidate: RankCandidate, parts: ScoreParts): number {
  const predicted = model.score({ candidate, parts });
  if (predicted == null || !Number.isFinite(predicted)) return parts.total;
  return predicted;
}

export function publicReason(parts: ScoreParts, sources: string[]): string {
  if (parts.trending > 0.2 && parts.trending >= parts.interest && parts.trending >= parts.exploration) {
    return 'rising';
  }
  if (parts.exploration > 0.2 && parts.exploration >= parts.interest) return 'new_for_you';
  if (parts.interest > 0.15) return 'matches_interest';
  if (sources.includes('following') || sources.includes('people')) {
    return sources.includes('following') ? 'following' : 'suggested_account';
  }
  if (parts.freshness > 0.5) return 'recent';
  return 'discovery';
}

/** Diversity pass. Caps apply only when an alternative author, kind, or tag exists. */
export function rerank(scored: ScoredCandidate[], weights: RankWeights): ScoredCandidate[] {
  const sorted = [...scored].sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const knownKinds = new Set(sorted.map((row) => row.kind));
  const knownTags = new Set(sorted.map((row) => row.primaryTag).filter((tag): tag is string => Boolean(tag)));
  const enforceKind = knownKinds.size > 1;
  const enforceTag = knownTags.size > 1;
  const out: ScoredCandidate[] = [];
  const deferred: ScoredCandidate[] = [];
  const authorCount = new Map<string, number>();
  const kindWindow: string[] = [];
  const tagWindow: string[] = [];

  const roomForOther = (window: string[], value: string, size: number, max: number, known: Set<string>) => {
    const recent = window.slice(-size);
    for (const other of known) {
      if (other === value) continue;
      if (recent.filter((item) => item === other).length < max) return true;
    }
    return false;
  };

  const blocked = (item: ScoredCandidate) => {
    if ((authorCount.get(item.authorId) ?? 0) >= weights.maxPerAuthor) return true;
    if (enforceKind) {
      const recent = kindWindow.slice(-weights.kindWindow);
      const same = recent.filter((kind) => kind === item.kind).length;
      if (same >= weights.maxSameKindInWindow && roomForOther(kindWindow, item.kind, weights.kindWindow, weights.maxSameKindInWindow, knownKinds)) {
        return true;
      }
    }
    if (enforceTag && item.primaryTag) {
      const recent = tagWindow.slice(-weights.tagWindow);
      const same = recent.filter((tag) => tag === item.primaryTag).length;
      if (
        same >= weights.maxSameTagInWindow &&
        roomForOther(tagWindow, item.primaryTag, weights.tagWindow, weights.maxSameTagInWindow, knownTags)
      ) {
        return true;
      }
    }
    return false;
  };

  const take = (item: ScoredCandidate) => {
    out.push(item);
    authorCount.set(item.authorId, (authorCount.get(item.authorId) ?? 0) + 1);
    kindWindow.push(item.kind);
    if (item.primaryTag) tagWindow.push(item.primaryTag);
  };

  for (const item of sorted) {
    if (blocked(item)) deferred.push(item);
    else take(item);
  }
  const leftovers: ScoredCandidate[] = [];
  for (const item of deferred) {
    if (blocked(item)) leftovers.push(item);
    else take(item);
  }
  for (const item of leftovers) take(item);

  if (weights.exploreEvery > 0) {
    for (let slot = weights.exploreEvery - 1; slot < out.length; slot += weights.exploreEvery) {
      const current = out[slot];
      if (!current || current.parts.exploration > 0) continue;
      let swapAt = -1;
      for (let j = slot + 1; j < out.length; j += 1) {
        const next = out[j];
        if (!next || next.parts.exploration <= 0) continue;
        const used = out.slice(0, slot).filter((row) => row.authorId === next.authorId).length;
        if (used >= weights.maxPerAuthor) continue;
        swapAt = j;
        break;
      }
      if (swapAt < 0) break;
      const replacement = out[swapAt];
      if (!current || !replacement) break;
      out[slot] = replacement;
      out[swapAt] = current;
    }
  }
  return out;
}

export function rankCandidates(
  candidates: RankCandidate[],
  vector: InterestVector,
  weights: RankWeights,
  nowMs: number,
  surface: RankSurface,
  model: RankingModel
): { ranked: ScoredCandidate[]; excluded: Record<string, number> } {
  const excluded: Record<string, number> = {};
  const scored: ScoredCandidate[] = [];
  const pool = candidates.slice(0, Math.max(1, weights.candidatePool));
  for (const candidate of pool) {
    const reason = exclusionReason(candidate, surface);
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
      continue;
    }
    const parts = scoreCandidate(candidate, vector, weights, nowMs, surface);
    const total = applyModel(model, candidate, parts);
    scored.push({
      candidate,
      parts,
      total,
      id: candidate.id,
      authorId: candidate.authorId,
      kind: candidate.kind,
      primaryTag: candidate.primaryTag
    });
  }
  return { ranked: rerank(scored, weights), excluded };
}

export function orderStoryIds(
  candidates: RankCandidate[],
  vector: InterestVector,
  weights: RankWeights,
  nowMs: number,
  model: RankingModel
): string[] {
  const { ranked } = rankCandidates(candidates, vector, weights, nowMs, 'stories', model);
  const best = new Map<string, number>();
  for (const row of ranked) {
    const prev = best.get(row.authorId);
    if (prev == null || row.total > prev) best.set(row.authorId, row.total);
  }
  const self = ranked.find((row) => row.candidate.self)?.authorId ?? null;
  const authors = [...best.entries()]
    .filter(([authorId]) => authorId !== self)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([authorId]) => authorId);
  const orderedAuthors = self ? [self, ...authors] : authors;
  const byAuthor = new Map<string, RankCandidate[]>();
  for (const candidate of candidates) {
    const list = byAuthor.get(candidate.authorId) ?? [];
    list.push(candidate);
    byAuthor.set(candidate.authorId, list);
  }
  const ids: string[] = [];
  for (const authorId of orderedAuthors) {
    const list = byAuthor.get(authorId) ?? [];
    list.sort((a, b) => b.createdAtMs - a.createdAtMs);
    for (const row of list) ids.push(row.id);
  }
  return ids;
}

export type PageSlice<T> = { items: T[]; nextCursor: string | null };

export function pageByCursor<T extends { id: string }>(
  items: T[],
  cursor: string | undefined,
  limit: number
): PageSlice<T> {
  const size = Math.min(Math.max(limit, 1), 60);
  let start = 0;
  if (cursor?.startsWith('rk1:')) {
    const n = Number(cursor.slice(4));
    if (Number.isInteger(n) && n >= 0 && n < 10_000) start = n;
  } else if (cursor) {
    const idx = items.findIndex((item) => item.id === cursor);
    if (idx >= 0) start = idx + 1;
  }
  const slice = items.slice(start, start + size);
  const next = start + slice.length < items.length ? `rk1:${start + slice.length}` : null;
  return { items: slice, nextCursor: next };
}

export function distribution(ids: Array<{ authorId: string; kind: string; primaryTag: string | null }>) {
  const authors = new Set<string>();
  const kinds: Record<string, number> = {};
  const tags: Record<string, number> = {};
  let maxAuthor = 0;
  const authorHits = new Map<string, number>();
  for (const row of ids) {
    authors.add(row.authorId);
    kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    authorHits.set(row.authorId, (authorHits.get(row.authorId) ?? 0) + 1);
    maxAuthor = Math.max(maxAuthor, authorHits.get(row.authorId) ?? 0);
    if (row.primaryTag) tags[row.primaryTag] = (tags[row.primaryTag] ?? 0) + 1;
  }
  return {
    items: ids.length,
    uniqueAuthors: authors.size,
    maxPerAuthor: maxAuthor,
    kinds,
    tags
  };
}

export function growthScore(recent: number, previous: number): number {
  if (recent < 3 || recent <= previous) return 0;
  return (recent - previous) / Math.max(previous, 1);
}
