import type { FoodClass } from './food-class-map.js';

/** A macro threshold. `netCarbsMaxPerServing` (keto) and `maxCarbShareOfCalories`
 * (low-carb, Edamam's <20% of calories from carbs) are the two the seeded catalog
 * supports; a rule sets whichever applies. */
export interface MacroRule {
  netCarbsMaxPerServing?: number;
  maxCarbShareOfCalories?: number;
}

/**
 * One diet as data (D-02): a set of forbidden food-classes, a curated list of
 * hidden/derived ingredient names the FDC category can't flag (D-03), and/or a macro
 * threshold. Adding a diet is a new entry here, no classifier change. Values are a
 * tunable code constant pending dietician sign-off (Q-03/Q-04).
 */
export interface DietRule {
  id: string;
  blockedClasses: FoodClass[];
  blockedIngredients: string[];
  macro?: MacroRule;
}

// Hidden/derived animal ingredients whose whole-food FDC category never reveals them —
// the documented #1 silent failure (Worcestershire → anchovies, gelatin → bones).
const HIDDEN_MEAT = ['gelatin', 'lard', 'tallow', 'suet', 'rennet', 'beef broth', 'chicken broth', 'bone broth', 'chicken stock', 'beef stock'];
const HIDDEN_SEAFOOD = ['anchovy', 'anchovies', 'fish sauce', 'oyster sauce', 'worcestershire', 'shrimp paste'];
const HIDDEN_DAIRY = ['whey', 'casein'];

// The plant classes carnivore forbids (the inverse blocklist).
const PLANT_CLASSES: FoodClass[] = ['grain', 'legume', 'vegetable', 'fruit', 'nuts_seeds', 'sweets'];

/**
 * The launch diet set (Q-03). Exclusion diets use classes + hidden-ingredient names;
 * keto/low-carb are macro-only. Paleo/Whole30/low-FODMAP are deliberately absent — they
 * need finer distinctions than FDC categories carry (see DESIGN D-02).
 */
export const DIET_RULES: DietRule[] = [
  { id: 'vegetarian', blockedClasses: ['red_meat', 'poultry', 'seafood'], blockedIngredients: [...HIDDEN_MEAT, ...HIDDEN_SEAFOOD] },
  { id: 'vegan', blockedClasses: ['red_meat', 'poultry', 'seafood', 'dairy', 'egg'], blockedIngredients: [...HIDDEN_MEAT, ...HIDDEN_SEAFOOD, ...HIDDEN_DAIRY, 'honey'] },
  { id: 'pescatarian', blockedClasses: ['red_meat', 'poultry'], blockedIngredients: [...HIDDEN_MEAT] },
  { id: 'dairy_free', blockedClasses: ['dairy'], blockedIngredients: [...HIDDEN_DAIRY] },
  { id: 'red_meat_free', blockedClasses: ['red_meat'], blockedIngredients: ['gelatin', 'lard', 'tallow', 'suet', 'beef broth', 'bone broth', 'beef stock'] },
  { id: 'carnivore', blockedClasses: PLANT_CLASSES, blockedIngredients: [] },
  // Paleo excludes grains, legumes, and dairy (allows meat/fish/eggs/veg/fruit/nuts).
  // ponytail: the potato-excluded-but-sweet-potato-allowed and refined-sugar nuances are
  // finer than WWEIA categories carry (DESIGN D-02) — this is the clean, defensible core.
  { id: 'paleo', blockedClasses: ['grain', 'legume', 'dairy'], blockedIngredients: [...HIDDEN_DAIRY, 'peanut'] },
  // Mediterranean is a dietary PATTERN, not an exclusion/threshold, so it can't reduce
  // cleanly to our primitives (DESIGN D-02). Shipped as the best defensible proxy: it most
  // distinctively minimizes red/processed meat and added sugar. This intentionally does NOT
  // capture the pattern's positive emphasis (olive oil, fish, whole grains, legumes).
  // ponytail: exclusion proxy for a pattern — over-calls honey-sweetened dishes as unfit;
  // upgrade to a positive pattern score if Mediterranean ever needs real precision.
  { id: 'mediterranean', blockedClasses: ['red_meat', 'sweets'], blockedIngredients: [...HIDDEN_MEAT] },
  { id: 'keto', blockedClasses: [], blockedIngredients: [], macro: { netCarbsMaxPerServing: 7 } },
  { id: 'low_carb', blockedClasses: [], blockedIngredients: [], macro: { maxCarbShareOfCalories: 0.2 } },
];
