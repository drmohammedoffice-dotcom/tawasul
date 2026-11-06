import { exclusionReason, rankCandidates } from './rank';
import { estimateEngagement, engagementHint } from './predict';
import type { InterestVector, RankCandidate, RankSurface, RankWeights, ScoredCandidate } from './types';
import type { RankingModel } from './rank';

export type StageResult = {
  eligible: RankCandidate[];
  excluded: Record<string, number>;
  ranked: ScoredCandidate[];
};

/** Eligibility is its own stage and always runs before any score. */
export function filterEligible(candidates: RankCandidate[], surface: RankSurface): {
  eligible: RankCandidate[];
  excluded: Record<string, number>;
} {
  const excluded: Record<string, number> = {};
  const eligible: RankCandidate[] = [];
  for (const candidate of candidates) {
    const reason = exclusionReason(candidate, surface);
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else eligible.push(candidate);
  }
  return { eligible, excluded };
}

/**
 * Cheap order used only to choose who reaches the precise ranker.
 * The baseline page path does not depend on this cut unless multi-stage is enabled.
 */
export function firstStageOrder(candidates: RankCandidate[], nowMs: number): RankCandidate[] {
  return [...candidates].sort((a, b) => {
    const ageA = Math.max(0, nowMs - a.createdAtMs);
    const ageB = Math.max(0, nowMs - b.createdAtMs);
    const followA = a.following || a.self ? 1 : 0;
    const followB = b.following || b.self ? 1 : 0;
    return followB - followA || ageA - ageB;
  });
}

export function rankStaged(
  candidates: RankCandidate[],
  vector: InterestVector,
  weights: RankWeights,
  nowMs: number,
  surface: RankSurface,
  model: RankingModel,
  options: { multiStage: boolean; engagementHints: boolean }
): StageResult {
  const { eligible, excluded } = filterEligible(candidates, surface);
  const shortlist = options.multiStage ? firstStageOrder(eligible, nowMs).slice(0, weights.candidatePool) : eligible;
  const rankedBase = rankCandidates(shortlist, vector, weights, nowMs, surface, model);
  for (const [reason, count] of Object.entries(rankedBase.excluded)) {
    excluded[reason] = (excluded[reason] ?? 0) + count;
  }
  const ranked = options.engagementHints
    ? rankedBase.ranked
        .map((row) => {
          const hint = engagementHint(
            estimateEngagement({
              interest: row.parts.interest,
              freshness: row.parts.freshness,
              relationship: row.parts.relationship,
              quality: row.parts.quality,
              negative: row.parts.negative
            })
          );
          const total = row.total + hint;
          return { ...row, total, parts: { ...row.parts, total } };
        })
        .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
    : rankedBase.ranked;
  return { eligible, excluded, ranked };
}
