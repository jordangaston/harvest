import type { CandidateRecipe } from './types.js';
import { similarity } from './similarity.js';

/** MMR trade-off: 0 = pure preference, 1 = pure diversity. Small, so preference leads and diversity
 * only reorders near-ties. */
const MMR_LAMBDA = 0.3;

/** (1−λ)·score − λ·(max similarity to an already-chosen recipe). */
function mmrScore(c: CandidateRecipe, chosen: CandidateRecipe[]): number {
  const maxSim = chosen.reduce((m, o) => Math.max(m, similarity(c, o)), 0);
  return (1 - MMR_LAMBDA) * c.score - MMR_LAMBDA * maxSim;
}

/**
 * Greedy MMR top-N from a score-sorted pool — diversified alternatives for one slot. Preference
 * balanced against similarity to what's already picked; no repeats. Fewer than `n` when the pool
 * runs short (never a repeat, never a fake).
 */
export function mmrTopN(pool: CandidateRecipe[], n: number): CandidateRecipe[] {
  const chosen: CandidateRecipe[] = [];
  const remaining = [...pool];
  while (chosen.length < n && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    remaining.forEach((c, i) => {
      const s = mmrScore(c, chosen);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    });
    chosen.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return chosen;
}

/**
 * Picks one main per slot by MMR from that meal's pool, keeping the week's mains distinct. Returns a
 * main per slot in the given order; a slot whose pool is exhausted (all picks used) is skipped —
 * reported by its absence, never faked.
 * @param slotPools - One entry per slot to fill, each with that slot's ranked candidate pool.
 */
export function pickMains<S>(slotPools: { slot: S; pool: CandidateRecipe[] }[]): { slot: S; pick: CandidateRecipe }[] {
  const used = new Set<string>();
  const chosen: CandidateRecipe[] = [];
  const out: { slot: S; pick: CandidateRecipe }[] = [];
  for (const { slot, pool } of slotPools) {
    const available = pool.filter((c) => !used.has(c.recipeId));
    if (available.length === 0) continue; // pool exhausted → slot stays unfilled
    let best = available[0]!;
    let bestScore = mmrScore(best, chosen);
    for (const c of available) {
      const s = mmrScore(c, chosen);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    used.add(best.recipeId);
    chosen.push(best);
    out.push({ slot, pick: best });
  }
  return out;
}
