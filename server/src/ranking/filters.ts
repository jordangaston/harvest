import type { UserPreferences } from '../models/user-preferences.js';
import type { RankableRecipe } from './types.js';

/** A hard gate; a recipe excluded by any rule is dropped before scoring (O-01). */
export interface FilterRule {
  excludes(recipe: RankableRecipe, prefs: UserPreferences): boolean;
}

/** Severity decides filter-vs-soft: severe blocks any possibility, moderate blocks certainty, mild never. */
export class AllergenFilter implements FilterRule {
  excludes(recipe: RankableRecipe, prefs: UserPreferences): boolean {
    return prefs.allergens.some(({ allergen, severity }) => {
      if (severity === 'severe')
        return recipe.allergens.contains.includes(allergen)
          || recipe.allergens.mayContain.includes(allergen)
          || !recipe.allergens.complete;
      if (severity === 'moderate') return recipe.allergens.contains.includes(allergen);
      return false;
    });
  }
}

/** Strict diets exclude an incompatible verdict (unknown is kept, soft-penalized); flexible never excludes. */
export class DietFilter implements FilterRule {
  excludes(recipe: RankableRecipe, prefs: UserPreferences): boolean {
    return prefs.diets.some(({ dietId, strictness }) =>
      strictness === 'strict' && recipe.dietFit[dietId] === 'incompatible');
  }
}
