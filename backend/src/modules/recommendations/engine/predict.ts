/**
 * Hand-set engagement estimates. These are not probabilities from a trained model.
 * Each output is a separate target so watch time is not the only objective.
 */
export type EngagementEstimate = {
  watch: number;
  qualifiedView: number;
  completion: number;
  replay: number;
  like: number;
  comment: number;
  save: number;
  share: number;
  follow: number;
  notInterested: number;
  trained: false;
};

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

export function estimateEngagement(input: {
  interest: number;
  freshness: number;
  relationship: number;
  quality: number;
  negative: number;
}): EngagementEstimate {
  const base = unit(input.interest * 0.45 + input.freshness * 0.25 + input.relationship * 0.2 + input.quality * 0.1);
  const friction = unit(input.negative);
  return {
    watch: unit(base * 0.9 + 0.05),
    qualifiedView: unit(base * 0.7),
    completion: unit(base * 0.45 * (1 - friction * 0.5)),
    replay: unit(base * 0.15),
    like: unit(base * 0.35 * (1 - friction)),
    comment: unit(base * 0.12 * (1 - friction)),
    save: unit(base * 0.18 * (1 - friction)),
    share: unit(base * 0.1 * (1 - friction)),
    follow: unit(input.relationship * 0.2 + input.interest * 0.15),
    notInterested: unit(friction * 0.6 + (1 - input.interest) * 0.15),
    trained: false
  };
}

/** Bounded hint. It cannot dominate the baseline score. */
export function engagementHint(estimate: EngagementEstimate): number {
  return Math.max(-0.05, Math.min(0.05, (estimate.save + estimate.like - estimate.notInterested) * 0.05));
}
