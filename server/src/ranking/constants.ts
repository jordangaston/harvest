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
