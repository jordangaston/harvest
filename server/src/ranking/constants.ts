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

/** Meal-prep band → score (signal #10). `unsuitable` is 0.15 (down-weighted, not buried);
 * a calibration knob — recalibrate from the real catalog. Null fit → the signal is
 * unavailable and drops from the weighted average. */
export const MEAL_PREP_SCORE: Record<'unsuitable' | 'suitable' | 'designed', number> = {
  unsuitable: 0.15,
  suitable: 0.6,
  designed: 1.0,
};

/** Dish types that keep well when batch-cooked — the deterministic fallback's keeps-well
 * set (values are `recipe_categories` dish_type vocab members). */
export const MEAL_PREP_KEEPS_WELL_DISH_TYPES = ['soup', 'stew', 'bowl', 'casserole', 'curry'];

/** Servings at/above which the fallback treats a keeps-well dish as batch-intended. Above
 * the C4 default-4 (a normal dinner), so unspecified-servings recipes stay `unsuitable`. */
export const MEAL_PREP_BATCH_SERVINGS = 6;

export const PENALTY_MILD_ALLERGEN = 0.15;
export const PENALTY_FLEXIBLE_INCOMPATIBLE = 0.2;
export const PENALTY_UNKNOWN_VERDICT = 0.05;

// Swipe deck (WI-RANK-4). Tunable: how long a swiped card stays out of the deck, and
// the default/max deck batch size.
export const SWIPE_COOLDOWN_DAYS = 7;
export const DECK_DEFAULT_LIMIT = 5;
