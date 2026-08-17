import { normalize } from './normalize.js';
import type { FdcFoodRepository } from './fdc-food-repository.js';

/** A resolved ingredient→food match, with the confidence tier the estimator surfaces. */
export interface FoodMatch {
  fdcId: number;
  category: string | null;
  quality: 'high' | 'medium' | 'low';
}

/** The matcher capability consumers depend on (lets the categorizer inject a stub). */
export interface IngredientMatcher {
  match(name: string): Promise<FoodMatch | null>;
}

// bm25 thresholds for the trigram OR-search (lower bm25 = better overlap). Calibrated
// against the WI-1 fixture: clean single-token hits land ≈ -7 to -12, typos ≈ -6 to -10,
// stray-trigram noise ≈ -1 to -2. tunable (Q-01) — these are fixture-fit defaults, not
// universal truths; re-tune with the e2e coverage report when the full seed is loaded.
const ACCEPT_MAX_BM25 = -6.0; // ≤ this → high
const FLAG_MAX_BM25 = -4.0; //   (ACCEPT, this] → medium
const REJECT_MAX_BM25 = -2.0; // (FLAG, this] → low; above → unmatched (null)

/**
 * Matches a recipe ingredient name to an FDC food: `normalize` → trigram FTS5 search →
 * tier the best hit's bm25. One collaborator per responsibility (the repo does I/O).
 */
export class FoodMatcher implements IngredientMatcher {
  constructor(private readonly repo: FdcFoodRepository) {}

  static create(repo: FdcFoodRepository): FoodMatcher {
    return new FoodMatcher(repo);
  }

  /**
   * @param name - a raw ingredient name (e.g. "1 lb salmon fillet, skin on" already parsed to "salmon fillet").
   * @returns the best match tiered by bm25, or null when nothing clears the reject floor.
   */
  async match(name: string): Promise<FoodMatch | null> {
    const [best] = await this.repo.search(normalize(name));
    if (!best) return null;
    const quality = this.tier(best.bm25);
    if (!quality) return null;
    return { fdcId: best.fdcId, category: best.category, quality };
  }

  /** bm25 → quality tier, or null (below the reject floor = not a real match). */
  private tier(bm25: number): FoodMatch['quality'] | null {
    if (bm25 <= ACCEPT_MAX_BM25) return 'high';
    if (bm25 <= FLAG_MAX_BM25) return 'medium';
    if (bm25 <= REJECT_MAX_BM25) return 'low';
    return null;
  }
}
