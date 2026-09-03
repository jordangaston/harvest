import type { UserPreferences } from '../models/user-preferences.js';
import type { RankableRecipe } from './types.js';

/** One base signal: its normalized score (or null when unavailable) for a recipe. The base is
 * affinity + popularity (design D-06); directives modulate it in the engine, they aren't scorers. */
export interface SignalScorer {
  key: string;
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const FACET_KEY = { cuisine: 'cuisine', dish_type: 'dishType', primary_ingredient: 'primaryIngredient' } as const;

/** How strongly a taste directive pulls affinity: `firm` all the way (±1), `soft` halfway (±0.5).
 * `strict` is a filter (the recipe is dropped before scoring), so it never reaches affinity. */
const STRENGTH_MAGNITUDE: Record<string, number> = { soft: 0.5, firm: 1, strict: 1 };

/** Per facet: shares a liked value → positive, a disliked → negative (no liked), else 0; magnitude
 * by strength (firm ±1, soft ±0.5). Four facets: the three `recipe.categories` facets plus
 * `ingredient`, matched on the recipe's rolled-up `baseIngredientIds` (so an "okra" like/dislike
 * bites at base-ingredient granularity). Mean centered on 0.5 → a 0–1 taste score. */
export class AffinityScorer implements SignalScorer {
  key = 'affinity';
  score(recipe: RankableRecipe, prefs: UserPreferences): number | null {
    const sentiments: number[] = [];
    for (const facet of ['cuisine', 'dish_type', 'primary_ingredient'] as const) {
      const values = recipe.categories[FACET_KEY[facet]];
      if (values.length === 0) continue;
      sentiments.push(this.facetSentiment(facet, values, prefs));
    }
    if (recipe.baseIngredientIds.length > 0) {
      sentiments.push(this.facetSentiment('ingredient', recipe.baseIngredientIds, prefs));
    }
    if (sentiments.length === 0) return null;
    const mean = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    return clamp01(0.5 + 0.5 * mean);
  }

  /** A `more` likes it (+), a `less` dislikes it (−), scaled by the strongest matching directive's
   * strength; a like wins a tie with a dislike. Only taste dimensions reach here (never food_category). */
  private facetSentiment(facet: string, values: string[], prefs: UserPreferences): number {
    const directives = prefs.foodPrefs.filter((f) => f.scope === 'recipe' && f.dimension === facet && values.includes(f.value));
    const mag = (dir: 'more' | 'less') =>
      Math.max(0, ...directives.filter((f) => f.direction === dir).map((f) => STRENGTH_MAGNITUDE[f.strength]));
    if (directives.some((f) => f.direction === 'more')) return mag('more');
    if (directives.some((f) => f.direction === 'less')) return -mag('less');
    return 0;
  }
}

/** Base popularity signal — null until the popularity column ships (then it joins affinity as base). */
export class PopularityScorer implements SignalScorer {
  key = 'popularity';
  score(recipe: RankableRecipe): number | null {
    return recipe.popularity;
  }
}
