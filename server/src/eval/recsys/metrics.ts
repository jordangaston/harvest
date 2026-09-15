import { rankIds, type Recommender } from './types.js';

/** Tier 2 graded metrics: Precision@k / nDCG@k over a human-labeled gold set, plus the Spearman
 * rank correlation used to certify Tier 1 as a proxy for Tier 2. Pure functions. */

/** A query with human relevance labels per candidate (graded, e.g. 0..3; ≥1 = relevant). */
export interface LabeledQuery {
  anchor: string;
  labels: Record<string, number>;
}

/** Precision@k: fraction of the model's top-k labeled candidates that are relevant (label ≥ `rel`).
 * Denominator is min(k, #labeled) so a sparse gold anchor isn't unfairly penalized. */
export function precisionAtK(ranked: string[], labels: Record<string, number>, k: number, rel = 1): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  const hits = top.filter((id) => (labels[id] ?? 0) >= rel).length;
  return hits / Math.min(k, ranked.length);
}

/** nDCG@k with exponential gain `2^rel − 1` and log2 discount; 0 when the ideal DCG is 0. */
export function ndcgAtK(ranked: string[], labels: Record<string, number>, k: number): number {
  const gain = (rel: number) => Math.pow(2, rel) - 1;
  const dcg = (ids: string[]) => ids.slice(0, k).reduce((s, id, i) => s + gain(labels[id] ?? 0) / Math.log2(i + 2), 0);
  const ideal = Object.values(labels).sort((a, b) => b - a);
  const idcg = ideal.slice(0, k).reduce((s, rel, i) => s + gain(rel) / Math.log2(i + 2), 0);
  return idcg === 0 ? 0 : dcg(ranked) / idcg;
}

/** Spearman rank correlation of two aligned series (Pearson over fractional ranks; ties averaged). */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const ra = fractionalRanks(a);
  const rb = fractionalRanks(b);
  return pearson(ra, rb);
}

export interface GradedReport {
  name: string;
  precisionAtK: number;
  ndcgAtK: number;
  nQueries: number;
}

/** Score a model over the labeled gold set: mean P@k and nDCG@k across queries (each query ranks
 * only its own labeled candidates). Queries with <2 labels are skipped (nothing to rank). `rel` is
 * the P@k relevance threshold — 2 by design, since a "good rec" is a 2 or a 3 (a 1 is a bad rec). */
export function evaluateGraded(rec: Recommender, gold: LabeledQuery[], k = 10, rel = 2): GradedReport {
  const ps: number[] = [];
  const ns: number[] = [];
  for (const q of gold) {
    const cands = Object.keys(q.labels);
    if (cands.length < 2) continue;
    const ranked = rankIds(rec, q.anchor, cands);
    ps.push(precisionAtK(ranked, q.labels, k, rel));
    ns.push(ndcgAtK(ranked, q.labels, k));
  }
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  return { name: rec.name, precisionAtK: mean(ps), ndcgAtK: mean(ns), nQueries: ps.length };
}

export interface ConcordanceReport {
  name: string;
  /** Fraction of differently-labeled candidate pairs the model orders correctly (0.5 = chance). */
  concordance: number;
  /** Anchors with ≥1 differently-labeled pair. */
  nQueries: number;
  /** Total differently-labeled pairs scored across all anchors. */
  nPairs: number;
}

/**
 * Pairwise concordance — the right metric for a max-disagreement gold set: for each anchor, over
 * every pair of its labeled candidates with *different* human relevance, does the model rank the
 * more-relevant one higher? Discriminative even with few candidates per anchor (unlike P@10/nDCG@10,
 * which degenerate when k exceeds the pool). Macro-averaged over anchors; 1.0 = perfect, 0.5 = chance.
 */
export function pairwiseConcordance(rec: Recommender, gold: LabeledQuery[]): ConcordanceReport {
  const perAnchor: number[] = [];
  let totalPairs = 0;
  for (const q of gold) {
    const cands = Object.keys(q.labels);
    if (cands.length < 2) continue;
    const pos = new Map(rankIds(rec, q.anchor, cands).map((id, i) => [id, i]));
    let correct = 0;
    let total = 0;
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        const a = cands[i]!;
        const b = cands[j]!;
        if (q.labels[a] === q.labels[b]) continue; // no signal in a tie
        total++;
        const [hi, lo] = q.labels[a]! > q.labels[b]! ? [a, b] : [b, a];
        if (pos.get(hi)! < pos.get(lo)!) correct++;
      }
    }
    if (total > 0) {
      perAnchor.push(correct / total);
      totalPairs += total;
    }
  }
  const mean = perAnchor.length === 0 ? 0 : perAnchor.reduce((a, b) => a + b, 0) / perAnchor.length;
  return { name: rec.name, concordance: mean, nQueries: perAnchor.length, nPairs: totalPairs };
}

/** Fractional (tie-averaged) ranks of the values, 1-based. */
function fractionalRanks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
  const ranks = new Array(xs.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && order[j]!.v === order[i]!.v) j++;
    const avg = (i + j + 1) / 2; // average of 1-based ranks i+1..j
    for (let t = i; t < j; t++) ranks[order[t]!.i] = avg;
    i = j;
  }
  return ranks;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}
