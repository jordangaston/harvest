/**
 * Reciprocal Rank Fusion: combine several ranked lists into one, rewarding items that rank well
 * across multiple lists and demoting single-list flukes. Rank-based, so the lists' own scores
 * (bm25, cosine, …) never need to be on a comparable scale. Unweighted — every list counts equally
 * (per-retriever weights are a later tuning knob, not needed for plain RRF to work).
 *
 * @param lists - each an array of ids ordered best-first.
 * @param k - the rank constant that smooths the head of each list (standard default 60).
 * @returns the fused ids, best-first.
 */
export function rrfFuse<T>(lists: readonly (readonly T[])[], k = 60): T[] {
  const score = new Map<T, number>();
  for (const list of lists) {
    list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank)));
  }
  // Stable sort + first-seen Map order → ties break toward the earlier list (deterministic).
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
