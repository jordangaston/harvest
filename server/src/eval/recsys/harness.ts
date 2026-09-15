import { rankIds, type GoldSet, type Recommender } from './types.js';

/** A model's score over a gold set: the headline MRR plus a per-cuisine breakdown. */
export interface ModelReport {
  name: string;
  mrr: number;
  nQueries: number;
  perCuisine: Record<string, { mrr: number; n: number }>;
  /** Set when the model can't really run (e.g. popularity before the signal ships). */
  note?: string;
}

/** Reciprocal rank of the first relevant id within the ranked list (0 if none present). */
function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranked.length; i++) if (relevant.has(ranked[i]!)) return 1 / (i + 1);
  return 0;
}

/** Mean of a list (0 for empty). */
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Score `rec` over `gold`: MRR across all queries, and MRR bucketed by query cuisine. The headline
 * MRR is the harness's built-in metric — enough to rank models and drive the self-test; the Tier
 * specs add graded metrics (P@k / nDCG) on top of the same frame.
 */
export function evaluate(rec: Recommender, gold: GoldSet, note?: string): ModelReport {
  const rrs: number[] = [];
  const byCuisine = new Map<string, number[]>();
  for (const q of gold.queries) {
    const rr = reciprocalRank(rankIds(rec, q.anchor, q.candidates), new Set(q.relevant));
    rrs.push(rr);
    const key = q.cuisine ?? '(none)';
    const bucket = byCuisine.get(key) ?? [];
    bucket.push(rr);
    byCuisine.set(key, bucket);
  }
  const perCuisine: Record<string, { mrr: number; n: number }> = {};
  for (const [c, xs] of byCuisine) perCuisine[c] = { mrr: mean(xs), n: xs.length };
  return { name: rec.name, mrr: mean(rrs), nQueries: rrs.length, perCuisine, note };
}

/** A fixed-width text report: headline MRR per model (best first) + the per-cuisine table. */
export function formatReport(reports: ModelReport[]): string {
  const n = reports[0]?.nQueries ?? 0;
  const lines = [`recsys eval — ${n} queries`, ''];
  lines.push('model         MRR');
  for (const r of [...reports].sort((a, b) => b.mrr - a.mrr)) {
    lines.push(`  ${r.name.padEnd(12)} ${r.note ? `— ${r.note}` : r.mrr.toFixed(3)}`);
  }
  const cuisines = [...new Set(reports.flatMap((r) => Object.keys(r.perCuisine)))].sort();
  if (cuisines.length > 1 || (cuisines.length === 1 && cuisines[0] !== '(none)')) {
    lines.push('', 'per-cuisine MRR');
    for (const c of cuisines) {
      const cells = reports.map((r) => `${r.name}=${r.perCuisine[c] ? r.perCuisine[c]!.mrr.toFixed(2) : '—'}`);
      lines.push(`  ${c.padEnd(14)} ${cells.join('  ')}`);
    }
  }
  return lines.join('\n');
}
