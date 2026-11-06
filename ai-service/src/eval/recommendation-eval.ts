/**
 * Offline evaluation helpers for ranking experiments.
 * Does not replace baseline-1.0.0 serving. Shadow numbers are synthetic until real labels exist.
 */

export type LabeledItem = { id: string; relevant: boolean; score: number };

export function precisionAtK(items: LabeledItem[], k: number): number {
  const head = items.slice(0, Math.max(1, k));
  const hits = head.filter((item) => item.relevant).length;
  return hits / head.length;
}

export function ndcgAtK(items: LabeledItem[], k: number): number {
  const head = items.slice(0, Math.max(1, k));
  const dcg = head.reduce((sum, item, index) => sum + (item.relevant ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = [...head]
    .sort((a, b) => Number(b.relevant) - Number(a.relevant))
    .reduce((sum, item, index) => sum + (item.relevant ? 1 / Math.log2(index + 2) : 0), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

export function compareToBaseline(candidate: LabeledItem[], baseline: LabeledItem[], k = 10) {
  return {
    candidate: { precision: precisionAtK(candidate, k), ndcg: ndcgAtK(candidate, k) },
    baseline: { precision: precisionAtK(baseline, k), ndcg: ndcgAtK(baseline, k) },
    promote: false,
    note: 'Promotion requires real-user consented labels and admin approval. Baseline remains served.'
  };
}
