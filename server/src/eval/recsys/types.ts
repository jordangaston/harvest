/** The recsys eval frame: one interface every recipe-similarity model plugs into, plus the
 * checked-in gold-set shape the runner scores against. Metrics content (triplets, graded relevance)
 * is the Tier specs' job; this is the frame they run in. */

/** A candidate with the model's predicted similarity to the query recipe (higher = closer). */
export type Scored = { id: string; score: number };

/** A recipe-similarity recommender: rank a candidate pool by predicted closeness to an anchor.
 * Item-item similarity (distinct from `RankingEngine.rank`, which is user personalization). */
export interface Recommender {
  readonly name: string;
  /** Rank `candidateIds` best→worst for the anchor. Pure + deterministic (a fixed input always
   * yields the same order) so the harness and its self-test are reproducible. */
  rankScored(anchorId: string, candidateIds: string[]): Scored[];
}

/** Ids only, best→worst — the `rank(recipeId)` view derived from `rankScored`. */
export function rankIds(rec: Recommender, anchorId: string, candidateIds: string[]): string[] {
  return rec.rankScored(anchorId, candidateIds).map((s) => s.id);
}

/** One evaluation query: rank `candidates` for `anchor`; `relevant` are the ids that count as
 * correct neighbors. `cuisine` (optional) buckets the diagnostic table. */
export interface GoldQuery {
  anchor: string;
  relevant: string[];
  candidates: string[];
  cuisine?: string;
}

/** A checked-in test set (`eval/gold/*.json`). Tier 1/2 populate the queries. */
export interface GoldSet {
  queries: GoldQuery[];
}
