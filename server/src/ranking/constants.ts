// Ranking tuning knobs. Literature/heuristic stopgaps — recalibrate from the real
// catalog once recipes exist (then just re-rank; no code change needed).

/** Dish types that keep well when batch-cooked — the deterministic fallback's keeps-well
 * set (values are `recipe_categories` dish_type vocab members). */
export const MEAL_PREP_KEEPS_WELL_DISH_TYPES = ['soup', 'stew', 'bowl', 'casserole', 'curry'];

/** Servings at/above which the fallback treats a keeps-well dish as batch-intended. Above
 * the C4 default-4 (a normal dinner), so unspecified-servings recipes stay `unsuitable`. */
export const MEAL_PREP_BATCH_SERVINGS = 6;

export const PENALTY_MILD_ALLERGEN = 0.15;
export const PENALTY_FLEXIBLE_INCOMPATIBLE = 0.2;
export const PENALTY_UNKNOWN_VERDICT = 0.05;

/**
 * How much a `soft`/`firm` food_category or nutrient directive multiplies the base score when the
 * recipe carries the directive's value (WI-3). `less` shrinks (`<1`), `more` grows (`>1`); `firm`
 * bites harder than `soft`. Only food_category/nutrient use this — the taste dimensions
 * (cuisine/dish_type/primary_ingredient/ingredient) carry strength inside the AffinityScorer's base
 * score, so the modulation layer leaves them alone.
 * ponytail: stopgap factors — validate against the live corpus (does a firm `less` visibly sink the
 * value?) and retune; no code change, just re-rank.
 */
export const DIRECTIVE_FACTOR = {
  soft: { less: 0.85, more: 1.15 },
  firm: { less: 0.6, more: 1.4 },
} as const;

/** Equipment signal (WI-EQ-3): a flat, once-per-recipe penalty when a reviewed user lacks any
 * `recommended` (substitutable) gear the recipe suggests. Flat, not per-item, to avoid burying a
 * recipe that merely names two gadgets. Tunable. */
export const PENALTY_MISSING_EQUIPMENT = 0.1;

// Swipe deck (WI-RANK-4). Tunable: how long a swiped card stays out of the deck, and
// the default/max deck batch size.
export const SWIPE_COOLDOWN_DAYS = 7;
export const DECK_DEFAULT_LIMIT = 10;
