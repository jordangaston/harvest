import { DIET_VERDICTS } from '../schema.js';

/** A per-diet compatibility verdict (WI-DS-1). `unknown` is a distinct state from
 * `incompatible`: it means we could not see enough to decide, never "fits everything". */
export type Verdict = (typeof DIET_VERDICTS)[number];

/** Why a diet is `incompatible`: the ingredient (or macro) that disqualified the recipe.
 * `class` is the FoodClass that blocked, `hidden` for a curated hidden-ingredient hit,
 * or `macro` for a threshold. Absent for `compatible`/`unknown` (nothing to name). */
export interface Blocker {
  kind: 'ingredient' | 'macro';
  value: string;
  class?: string;
}

/** The classifier's per-recipe result: a verdict per configured diet, plus the blocker
 * for each `incompatible` one. `coverageComplete` is a per-recipe monitoring signal
 * (did every ingredient match?), not stored — it explains why a clean recipe reads
 * `unknown` rather than `compatible`. */
export interface DietCompat {
  fit: Record<string, Verdict>;
  blockers: Record<string, Blocker>;
  coverageComplete: boolean;
}
