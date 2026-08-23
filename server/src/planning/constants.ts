import type { Tier } from './types.js';

// Meal-planning engine tuning knobs (WI-MP-2). Heuristic stopgaps — recalibrate from real
// plans once the feature ships. Kept together so tuning is one file, no code change.

/** Tier bonus added to the [0,1] ranking score to form `baseScore`. The step (10) far exceeds the
 * ranking range (1) and the MMR diversity swing (≤1), so tier is the PRIMARY sort and diversity only
 * reorders within a tier (design Q-02). */
export const TIER_BONUS: Record<Tier, number> = { imported: 30, liked: 20, saved: 10, global: 0 };

/** MMR trade-off: 0 = pure preference, 1 = pure diversity. Small, so preference leads (design Option B). */
export const MMR_LAMBDA = 0.3;

/** Target fraction of distinct cooks drawn from new/unseen recipes — the novelty portfolio (P3, D-02). */
export const NEW_RATIO = 0.3;

/** A cooked batch may be served across at most this many slots of a meal-type (leftover budget, Q-09). */
export const LEFTOVER_BUDGET_FRACTION = 0.4;

/** A single batch spans at most this many days for food safety (Q-09). */
export const MAX_BATCH_SPAN_DAYS = 3;

/** Cross-week recency window: a recipe cooked within this many days is excluded from candidates
 * (Q-03; longer than the 7-day swipe cooldown — a served dinner should rest longer than a swiped card). */
export const MEAL_COOLDOWN_DAYS = 14;

/** Recipe meal-prep fits that keep well enough to batch into leftovers (P7 eligibility). */
export const KEEPS_WELL_FITS = new Set(['suitable', 'designed']);
