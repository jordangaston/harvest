import type { RecipeDifficulty, DifficultyBand } from '../models/recipe.js';
import { DIFFICULTY_CONFIG } from './technique-difficulty.js';
import { TechniqueMatcher } from './technique-matcher.js';

/**
 * DifficultyScorer (WI-DIFF-2, O-DIFF-02/03) — blends the per-step technique ceiling
 * with the recipe's shape (step count, ingredient count, total time) into a continuous
 * 0–100 score and its band. Pure and deterministic: no LLM, no network, no DB.
 *
 *   raw = 100 × mean(T, S, N, [M])
 *     T = max(step weights)/5         (0 with no steps)
 *     S = min(steps, STEP_CAP)/STEP_CAP
 *     N = min(ings, ING_CAP)/ING_CAP
 *     M = min(minutes, TIME_CAP)/TIME_CAP   (dropped from the mean when minutes is null)
 *
 * Band: raw < C50 → beginner, C50 ≤ raw < C85 → intermediate, raw ≥ C85 → advanced.
 */
export class DifficultyScorer {
  private constructor(private readonly matcher: TechniqueMatcher) {}

  /** Wire the scorer with the shared technique matcher. */
  static create(): DifficultyScorer {
    return new DifficultyScorer(TechniqueMatcher.create());
  }

  /**
   * Scores a recipe's difficulty from its finalized steps and shape.
   * @param steps - The recipe's ordered step texts (post section-strip).
   * @param ingredientCount - The recipe's finalized ingredient count.
   * @param totalMinutes - Total time in minutes, or null when the source omits it.
   * @returns The score (one decimal), band, and per-step weights aligned to `steps`.
   */
  score(steps: string[], ingredientCount: number, totalMinutes: number | null): RecipeDifficulty {
    const { STEP_CAP, ING_CAP, TIME_CAP } = DIFFICULTY_CONFIG;
    const stepDifficulties = this.matcher.stepWeights(steps);

    const factors = [
      stepDifficulties.length ? Math.max(...stepDifficulties) / 5 : 0,
      Math.min(steps.length, STEP_CAP) / STEP_CAP,
      Math.min(ingredientCount, ING_CAP) / ING_CAP,
    ];
    if (totalMinutes != null) factors.push(Math.min(totalMinutes, TIME_CAP) / TIME_CAP);

    const raw = 100 * (factors.reduce((sum, f) => sum + f, 0) / factors.length);
    return { score: Math.round(raw * 10) / 10, band: bandOf(raw), stepDifficulties };
  }
}

/** Buckets a raw score into its band — inclusive-lower cutoffs (C50, C85). */
function bandOf(raw: number): DifficultyBand {
  const { C50, C85 } = DIFFICULTY_CONFIG;
  if (raw < C50) return 'beginner';
  if (raw < C85) return 'intermediate';
  return 'advanced';
}
