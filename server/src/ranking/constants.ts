// Ranking tuning knobs. Literature/heuristic stopgaps — recalibrate from the real
// catalog once recipes exist (then just re-rank; no code change needed).

/** NRF value that scores 0.5 in the nutrition squash x⁺/(x⁺+k); NRF 15/3 whole-diet mean. */
export const NUTRITION_K = 57;

/** Cost/time curves ramp to 0 at this multiple of the user's budget. */
export const BUDGET_SLOPE = 2;

/** Asymmetric difficulty score by signed distance d = bandRank − skillRank. */
export const DIFFICULTY_BY_DISTANCE: Record<number, number> = {
  [-2]: 0.7,
  [-1]: 0.85,
  [0]: 1.0,
  [1]: 0.6,
  [2]: 0.2,
};

export const PENALTY_MILD_ALLERGEN = 0.15;
export const PENALTY_FLEXIBLE_INCOMPATIBLE = 0.2;
export const PENALTY_UNKNOWN_VERDICT = 0.05;

/** Equipment signal (WI-EQ-3): a flat, once-per-recipe penalty when a reviewed user lacks any
 * `recommended` (substitutable) gear the recipe suggests. Flat, not per-item, to avoid burying a
 * recipe that merely names two gadgets. Tunable. */
export const PENALTY_MISSING_EQUIPMENT = 0.1;

// Swipe deck (WI-RANK-4). Tunable: how long a swiped card stays out of the deck, and
// the default/max deck batch size.
export const SWIPE_COOLDOWN_DAYS = 7;
export const DECK_DEFAULT_LIMIT = 5;
