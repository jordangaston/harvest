import { rankIds, type Recommender } from './types.js';

/** A candidate the two models rank very differently for an anchor — the discriminating pairs worth
 * a human label (both models agreeing tells us nothing new). */
export interface MinedPair {
  anchor: string;
  candidate: string;
  rankA: number;
  rankB: number;
  disagreement: number;
}

/**
 * Mine the `perAnchor` candidates with the largest rank disagreement `|rank_a − rank_b|` between two
 * models for one anchor. Ranks are positions in each model's ordering of `candidates`. Ties broken
 * by candidate id for determinism.
 */
export function mineDisagreements(
  anchor: string,
  candidates: string[],
  a: Recommender,
  b: Recommender,
  perAnchor: number,
): MinedPair[] {
  const rankOf = (rec: Recommender) => {
    const order = rankIds(rec, anchor, candidates);
    return new Map(order.map((id, i) => [id, i]));
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  return candidates
    .map((candidate) => {
      const rankA = ra.get(candidate)!;
      const rankB = rb.get(candidate)!;
      return { anchor, candidate, rankA, rankB, disagreement: Math.abs(rankA - rankB) };
    })
    .sort((x, y) => y.disagreement - x.disagreement || (x.candidate < y.candidate ? -1 : 1))
    .slice(0, perAnchor);
}
