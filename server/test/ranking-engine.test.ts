import { describe, it, expect } from 'vitest';
import type { UserPreferences } from '../src/models/user-preferences.js';
import type { RankableRecipe } from '../src/ranking/types.js';
import { AllergenFilter, DietFilter, EquipmentFilter } from '../src/ranking/filters.js';
import {
  CostScorer, DifficultyScorer, NutritionScorer, AffinityScorer, TimeScorer, PopularityScorer, MealPrepScorer,
} from '../src/ranking/scorers.js';
import { RankingEngine } from '../src/ranking/ranking-engine.js';

/** WI-RANK-2 — pure RankingEngine: scorer normalization, filters, combination, penalties, tie-breaks, worked example. */

function rankableRecipe(overrides: Partial<RankableRecipe> = {}): RankableRecipe {
  return {
    id: 'r1',
    createdAt: new Date('2026-01-01'),
    costPerServingCents: 300,
    difficultyBand: 'intermediate',
    mealPrepFit: null,
    nrfScore: 50,
    totalMinutes: 30,
    mealTypes: [],
    categories: { cuisine: [], dishType: [], primaryIngredient: [], foodCategory: [] },
    baseIngredientIds: [],
    allergens: { contains: [], mayContain: [], complete: true },
    dietFit: {},
    equipment: [],
    equipmentComplete: true,
    popularity: null,
    ...overrides,
  };
}

function preferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    userId: 'u1',
    skillLevel: 'intermediate',
    budgetCentsPerServing: 400,
    weeklyBudgetCents: null,
    timeBudgetMinutes: 30,
    timeByMeal: null,
    weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 },
    weights: { cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 0 },
    allergens: [],
    diets: [],
    foodPrefs: [],
    ownedEquipment: [],
    equipmentReviewed: false,
    groceryStores: [],
    household: { adults: 2, kids: 0 },
    eatsLeftovers: true,
    ...overrides,
  };
}

const round1 = (x: number) => Math.round(x * 100 * 10) / 10;

/** A food pref with axis defaults (sentiment/target/reason null unless given). */
function fp(p: { facet: UserPreferences['foodPrefs'][number]['facet']; value: string; sentiment?: 'like' | 'dislike'; target?: number; reason?: string }): UserPreferences['foodPrefs'][number] {
  return { facet: p.facet, value: p.value, sentiment: p.sentiment ?? null, target: p.target ?? null, reason: p.reason ?? null };
}
/** A RankableRecipe categories bucket with foodCategory defaulting to []. */
function cats(o: Partial<RankableRecipe['categories']> = {}): RankableRecipe['categories'] {
  return { cuisine: [], dishType: [], primaryIngredient: [], foodCategory: [], ...o };
}

describe('scorer normalization (Test Case 1)', () => {
  const p = preferences();

  it('cost: at budget → 1, at 2× → 0, under → 1, null → null', () => {
    const cost = new CostScorer();
    expect(cost.score(rankableRecipe({ costPerServingCents: 400 }), p)).toBe(1);
    expect(cost.score(rankableRecipe({ costPerServingCents: 800 }), p)).toBe(0);
    expect(cost.score(rankableRecipe({ costPerServingCents: 200 }), p)).toBe(1);
    expect(cost.score(rankableRecipe({ costPerServingCents: null }), p)).toBeNull();
    expect(cost.score(rankableRecipe(), preferences({ budgetCentsPerServing: null }))).toBeNull();
  });

  it('time: symmetric to cost', () => {
    const time = new TimeScorer();
    expect(time.score(rankableRecipe({ totalMinutes: 30 }), p)).toBe(1);
    expect(time.score(rankableRecipe({ totalMinutes: 60 }), p)).toBe(0);
    expect(time.score(rankableRecipe({ totalMinutes: null }), p)).toBeNull();
  });

  describe('time: per-meal budget (pickBudget)', () => {
    const time = new TimeScorer();
    // dinner budget 40 → at 40min = 1, at 80 = 0; breakfast budget 20; lunch 60.
    const perMeal = preferences({ timeByMeal: { breakfast: 20, lunch: 60, dinner: 40 }, timeBudgetMinutes: 60 });

    it('single meal_type uses that meal’s budget', () => {
      expect(time.score(rankableRecipe({ mealTypes: ['dinner'], totalMinutes: 40 }), perMeal)).toBe(1);
      expect(time.score(rankableRecipe({ mealTypes: ['dinner'], totalMinutes: 80 }), perMeal)).toBe(0);
      // Same 40-min recipe scored against the tighter breakfast budget (20) is over budget → 0.
      expect(time.score(rankableRecipe({ mealTypes: ['breakfast'], totalMinutes: 40 }), perMeal)).toBe(0);
    });

    it('multi meal_type uses the most-generous applicable budget (max)', () => {
      // breakfast(20) + lunch(60) → budget 60: (120-90)/60 = 0.5. The tighter breakfast(20) would give 0.
      expect(time.score(rankableRecipe({ mealTypes: ['breakfast', 'lunch'], totalMinutes: 90 }), perMeal)).toBe(0.5);
    });

    it('brunch resolves to the breakfast budget', () => {
      expect(time.score(rankableRecipe({ mealTypes: ['brunch'], totalMinutes: 20 }), perMeal)).toBe(1);
      expect(time.score(rankableRecipe({ mealTypes: ['brunch'], totalMinutes: 40 }), perMeal)).toBe(0);
    });

    it('no applicable meal_type falls back to the most-generous overall budget', () => {
      // [] and snack-only both use max(20,60,40)=60 → (120-90)/60 = 0.5.
      expect(time.score(rankableRecipe({ mealTypes: [], totalMinutes: 90 }), perMeal)).toBe(0.5);
      expect(time.score(rankableRecipe({ mealTypes: ['snack'], totalMinutes: 90 }), perMeal)).toBe(0.5);
    });

    it('null timeByMeal falls back to the scalar; both null → null', () => {
      const scalarOnly = preferences({ timeByMeal: null, timeBudgetMinutes: 30 });
      expect(time.score(rankableRecipe({ mealTypes: ['dinner'], totalMinutes: 30 }), scalarOnly)).toBe(1);
      const neither = preferences({ timeByMeal: null, timeBudgetMinutes: null });
      expect(time.score(rankableRecipe({ mealTypes: ['dinner'], totalMinutes: 30 }), neither)).toBeNull();
    });

    it('null totalMinutes → null even with a per-meal budget', () => {
      expect(time.score(rankableRecipe({ mealTypes: ['dinner'], totalMinutes: null }), perMeal)).toBeNull();
    });
  });

  it('difficulty: match → 1, one-easier → 0.85, two-harder → 0.20, null → null', () => {
    const diff = new DifficultyScorer();
    expect(diff.score(rankableRecipe({ difficultyBand: 'intermediate' }), p)).toBe(1);
    expect(diff.score(rankableRecipe({ difficultyBand: 'beginner' }), p)).toBe(0.85);
    expect(diff.score(rankableRecipe({ difficultyBand: 'advanced' }), preferences({ skillLevel: 'beginner' }))).toBe(0.2);
    expect(diff.score(rankableRecipe({ difficultyBand: null }), p)).toBeNull();
  });

  it('nutrition: 0 → 0, 57 → 0.5, 250 → ≈0.814, negative → 0, null → null', () => {
    const n = new NutritionScorer();
    expect(n.score(rankableRecipe({ nrfScore: 0 }))).toBe(0);
    expect(n.score(rankableRecipe({ nrfScore: 57 }))).toBe(0.5);
    expect(n.score(rankableRecipe({ nrfScore: 250 }))!).toBeCloseTo(0.814, 3);
    expect(n.score(rankableRecipe({ nrfScore: -10 }))).toBe(0);
    expect(n.score(rankableRecipe({ nrfScore: null }))).toBeNull();
  });

  it('affinity: all-liked → 1, all-neutral → 0.5, all-disliked → 0, no categories → null', () => {
    const aff = new AffinityScorer();
    const liked = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', sentiment: 'like' })] });
    const disliked = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', sentiment: 'dislike' })] });
    const italian = rankableRecipe({ categories: cats({ cuisine: ['italian'] }) });
    expect(aff.score(italian, liked)).toBe(1);
    expect(aff.score(italian, p)).toBe(0.5);
    expect(aff.score(italian, disliked)).toBe(0);
    expect(aff.score(rankableRecipe(), p)).toBeNull();
  });

  // O-AF-1: the ingredient facet intersects the user's picked base_ingredient_ids with the
  // recipe's rolled-up baseIngredientIds — an "okra" dislike bites at base-ingredient granularity.
  it('affinity ingredient facet: liked → 1, disliked → 0, no overlap → 0.5 within the four-facet mean', () => {
    const aff = new AffinityScorer();
    const okra = 'okra-uuid';
    const recipe = rankableRecipe({ categories: cats(), baseIngredientIds: [okra] });
    const liked = preferences({ foodPrefs: [fp({ facet: 'ingredient', value: okra, sentiment: 'like' })] });
    const disliked = preferences({ foodPrefs: [fp({ facet: 'ingredient', value: okra, sentiment: 'dislike' })] });
    expect(aff.score(recipe, liked)).toBe(1); // only facet present → mean 1 → 0.5+0.5
    expect(aff.score(recipe, disliked)).toBe(0);
    expect(aff.score(recipe, p)).toBe(0.5); // no matching pref → neutral
    // No overlap between a picked id and the recipe's ids → neutral 0.5.
    const other = preferences({ foodPrefs: [fp({ facet: 'ingredient', value: 'spinach-uuid', sentiment: 'dislike' })] });
    expect(aff.score(recipe, other)).toBe(0.5);
    // Empty baseIngredientIds → the ingredient facet contributes nothing (here: null overall).
    expect(aff.score(rankableRecipe({ baseIngredientIds: [] }), disliked)).toBeNull();
  });

  it('popularity: always null', () => {
    expect(new PopularityScorer().score()).toBeNull();
  });

  it('meal-prep: designed → 1.0, suitable → 0.6, unsuitable → 0.15, null → null; weight reads prefs', () => {
    const mp = new MealPrepScorer();
    expect(mp.score(rankableRecipe({ mealPrepFit: 'designed' }))).toBe(1.0);
    expect(mp.score(rankableRecipe({ mealPrepFit: 'suitable' }))).toBe(0.6);
    expect(mp.score(rankableRecipe({ mealPrepFit: 'unsuitable' }))).toBe(0.15);
    expect(mp.score(rankableRecipe({ mealPrepFit: null }))).toBeNull();
    expect(mp.weight(preferences({ weights: { cost: 1, difficulty: 1, nutrition: 1, affinity: 1, time: 1, popularity: 0, mealPrep: 2 } }))).toBe(2);
  });
});

describe('allergen filter matrix (Test Case 2)', () => {
  const contains = rankableRecipe({ allergens: { contains: ['peanut'], mayContain: [], complete: true } });
  const may = rankableRecipe({ allergens: { contains: [], mayContain: ['peanut'], complete: true } });
  const incomplete = rankableRecipe({ allergens: { contains: [], mayContain: [], complete: false } });
  const filter = new AllergenFilter();
  const withSeverity = (s: 'severe' | 'moderate' | 'mild') =>
    preferences({ allergens: [{ allergen: 'peanut', severity: s }] });

  it('severe excludes contains, mayContain and incomplete', () => {
    const p = withSeverity('severe');
    expect(filter.excludes(contains, p)).toBe(true);
    expect(filter.excludes(may, p)).toBe(true);
    expect(filter.excludes(incomplete, p)).toBe(true);
  });

  it('moderate excludes only contains', () => {
    const p = withSeverity('moderate');
    expect(filter.excludes(contains, p)).toBe(true);
    expect(filter.excludes(may, p)).toBe(false);
    expect(filter.excludes(incomplete, p)).toBe(false);
  });

  it('mild excludes none', () => {
    const p = withSeverity('mild');
    expect(filter.excludes(contains, p)).toBe(false);
    expect(filter.excludes(may, p)).toBe(false);
    expect(filter.excludes(incomplete, p)).toBe(false);
  });
});

describe('diet filter matrix (Test Case 3)', () => {
  const filter = new DietFilter();
  const incompatible = rankableRecipe({ dietFit: { vegan: 'incompatible' } });
  const unknown = rankableRecipe({ dietFit: { vegan: 'unknown' } });

  it('strict excludes incompatible, keeps unknown', () => {
    const p = preferences({ diets: [{ dietId: 'vegan', strictness: 'strict' }] });
    expect(filter.excludes(incompatible, p)).toBe(true);
    expect(filter.excludes(unknown, p)).toBe(false);
  });

  it('flexible excludes neither', () => {
    const p = preferences({ diets: [{ dietId: 'vegan', strictness: 'flexible' }] });
    expect(filter.excludes(incompatible, p)).toBe(false);
    expect(filter.excludes(unknown, p)).toBe(false);
  });
});

describe('equipment filter matrix (WI-EQ-3)', () => {
  const filter = new EquipmentFilter();
  const reviewed = (owned: ('air_fryer' | 'sous_vide')[] = []) => preferences({ equipmentReviewed: true, ownedEquipment: owned });
  const requiredItem = (complete: boolean) => rankableRecipe({ equipment: [{ equipment: 'sous_vide', essentiality: 'required' }], equipmentComplete: complete });
  const recommendedItem = rankableRecipe({ equipment: [{ equipment: 'air_fryer', essentiality: 'recommended' }], equipmentComplete: true });

  it('unreviewed kitchen never excludes', () => {
    expect(filter.excludes(requiredItem(true), preferences())).toBe(false);
  });
  it('incomplete detection stays lenient', () => {
    expect(filter.excludes(requiredItem(false), reviewed())).toBe(false);
  });
  it('required-missing excludes; required-owned keeps', () => {
    expect(filter.excludes(requiredItem(true), reviewed())).toBe(true);
    expect(filter.excludes(requiredItem(true), reviewed(['sous_vide']))).toBe(false);
  });
  it('recommended-missing keeps (the soft penalty, not the filter)', () => {
    expect(filter.excludes(recommendedItem, reviewed())).toBe(false);
  });
});

describe('missing-equipment soft penalty (WI-EQ-3)', () => {
  const engine = RankingEngine.create();
  // average = (cost 1 + difficulty 1 + nutrition 0.5 + affinity 0.5 + time 1)/5 = 0.8.
  const recipe = (equipment: RankableRecipe['equipment']) =>
    rankableRecipe({
      costPerServingCents: 400, difficultyBand: 'intermediate', nrfScore: 57, totalMinutes: 30,
      categories: cats({ cuisine: ['italian'] }),
      equipment, equipmentComplete: true,
    });
  const airFryer: RankableRecipe['equipment'] = [{ equipment: 'air_fryer', essentiality: 'recommended' }];

  it('subtracts a flat 0.10 for a reviewed user missing recommended gear', () => {
    const [r] = engine.rank([recipe(airFryer)], preferences({ equipmentReviewed: true, ownedEquipment: [] }));
    expect(r.score).toBeCloseTo(0.8 - 0.1, 6);
  });
  it('no penalty when the gear is owned, or the kitchen is unreviewed', () => {
    expect(engine.rank([recipe(airFryer)], preferences({ equipmentReviewed: true, ownedEquipment: ['air_fryer'] }))[0].score).toBeCloseTo(0.8, 6);
    expect(engine.rank([recipe(airFryer)], preferences({ equipmentReviewed: false }))[0].score).toBeCloseTo(0.8, 6);
  });
  it('is flat once, not per item', () => {
    const two: RankableRecipe['equipment'] = [
      { equipment: 'air_fryer', essentiality: 'recommended' },
      { equipment: 'blender', essentiality: 'recommended' },
    ];
    expect(engine.rank([recipe(two)], preferences({ equipmentReviewed: true, ownedEquipment: [] }))[0].score).toBeCloseTo(0.8 - 0.1, 6);
  });
});

describe('food-moderation down-weight (Test Case 5, 6 — AC 5/6/7)', () => {
  const engine = RankingEngine.create();
  // average = (cost 1 + difficulty 1 + nutrition 0.5 + time 1)/4 = 0.875 with affinity dropped
  // (no matching pref → null) UNLESS a food_category like is present. Build a recipe whose only
  // categorical signal is its food class, so affinity is null and the base score is stable.
  const redMeat = () => rankableRecipe({
    costPerServingCents: 400, difficultyBand: 'intermediate', nrfScore: 57, totalMinutes: 30,
    categories: cats({ foodCategory: ['red_meat'] }),
  });
  const chicken = () => rankableRecipe({
    id: 'chicken', costPerServingCents: 400, difficultyBand: 'intermediate', nrfScore: 57, totalMinutes: 30,
    categories: cats({ foodCategory: ['poultry'] }),
  });
  const limitRedMeat = preferences({ weights: { cost: 1, difficulty: 1, nutrition: 1, affinity: 0, time: 1, popularity: 0, mealPrep: 0 }, foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', target: -0.6 })] });
  const noPref = preferences({ weights: { cost: 1, difficulty: 1, nutrition: 1, affinity: 0, time: 1, popularity: 0, mealPrep: 0 } });

  it('Test Case 5: red-meat recipe drops by MODERATION_PENALTY_MAX*0.6, non-red-meat unchanged, none excluded, +target inert', () => {
    const withPref = engine.rank([redMeat(), chicken()], limitRedMeat);
    const without = engine.rank([redMeat(), chicken()], noPref);
    const score = (r: typeof withPref, id: string) => r.find((x) => x.recipeId === id)!.score;

    // Red-meat recipe sinks by exactly 0.3*0.6 = 0.18; nothing is filtered out (still 2 recipes).
    expect(withPref.length).toBe(2);
    expect(score(without, 'r1') - score(withPref, 'r1')).toBeCloseTo(0.3 * 0.6, 6);
    // The non-red-meat (poultry) recipe is untouched.
    expect(score(withPref, 'chicken')).toBeCloseTo(score(without, 'chicken'), 6);

    // A positive target on a food class the recipes don't carry changes nothing (less-only milestone).
    const positive = preferences({ weights: limitRedMeat.weights, foodPrefs: [fp({ facet: 'food_category', value: 'seafood', target: 0.8 })] });
    expect(engine.rank([redMeat()], positive)[0].score).toBeCloseTo(score(without, 'r1'), 6);
  });

  it('Test Case 6: a food_category like raises affinity while the moderation penalty still applies; pure-intent adds no affinity', () => {
    const aff = new AffinityScorer();
    const recipe = redMeat();
    // sentiment=like on the food class → affinity treats red meat as liked (contributes 1, not a dislike).
    const likedAndLimited = preferences({ foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', sentiment: 'like', target: -0.6 })] });
    // The affinity scorer only reads the three category facets + ingredient; food_category isn't one of
    // those buckets, so affinity is null here — but crucially the like is NOT read as a dislike.
    const disliked = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', sentiment: 'dislike' })] });
    const italian = rankableRecipe({ categories: cats({ cuisine: ['italian'] }) });
    expect(aff.score(italian, disliked)).toBe(0); // sanity: a real dislike scores 0
    // The moderation penalty still subtracts for the liked-but-limited red-meat recipe.
    const withLike = engine.rank([recipe], likedAndLimited)[0];
    const plain = engine.rank([recipe], preferences())[0];
    expect(plain.score - withLike.score).toBeCloseTo(0.3 * 0.6, 6);

    // A pure-intent row (sentiment null) contributes nothing to affinity.
    const pureIntent = preferences({ foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', target: -0.6 })] });
    expect(aff.score(rankableRecipe({ categories: cats({ cuisine: ['italian'] }) }), pureIntent)).toBe(0.5); // neutral, no signal
  });
});

describe('equipment worked example (WI-EQ-3)', () => {
  const engine = RankingEngine.create();
  const base = {
    costPerServingCents: 400, difficultyBand: 'intermediate' as const, nrfScore: 57, totalMinutes: 30,
    categories: cats(), equipmentComplete: true,
  };
  const A = rankableRecipe({ id: 'A', ...base, equipment: [{ equipment: 'sous_vide', essentiality: 'required' }] });
  const B = rankableRecipe({ id: 'B', ...base, equipment: [{ equipment: 'air_fryer', essentiality: 'recommended' }] });
  const C = rankableRecipe({ id: 'C', ...base, equipment: [{ equipment: 'slow_cooker', essentiality: 'required' }] });
  const D = rankableRecipe({ id: 'D', ...base, equipment: [] });
  const E = rankableRecipe({ id: 'E', ...base, equipmentComplete: false, equipment: [{ equipment: 'smoker', essentiality: 'required' }] });
  const reviewed = preferences({ equipmentReviewed: true, ownedEquipment: ['slow_cooker', 'blender'] });
  const score = (ranked: { recipeId: string; score: number }[], id: string) => ranked.find((r) => r.recipeId === id)!.score;

  // average = (cost 1 + difficulty 1 + nutrition 0.5 + time 1)/4 = 0.875 (empty categories → affinity null).
  it('reviewed → excludes A, keeps B/C/D/E, penalizes only B by 0.10', () => {
    const ranked = engine.rank([A, B, C, D, E], reviewed);
    expect(ranked.map((r) => r.recipeId).sort()).toEqual(['B', 'C', 'D', 'E']);
    expect(score(ranked, 'D')).toBeCloseTo(0.875, 6);
    expect(score(ranked, 'C')).toBeCloseTo(0.875, 6);
    expect(score(ranked, 'E')).toBeCloseTo(0.875, 6);
    expect(score(ranked, 'B')).toBeCloseTo(0.875 - 0.1, 6);
  });

  it('unreviewed → keeps all five, none penalized', () => {
    const ranked = engine.rank([A, B, C, D, E], preferences({ equipmentReviewed: false }));
    expect(ranked).toHaveLength(5);
    for (const r of ranked) expect(r.score).toBeCloseTo(0.875, 6);
  });
});

describe('combination (Test Case 4)', () => {
  const engine = RankingEngine.create();

  it('drops null signals from the denominator', () => {
    const recipe = rankableRecipe({
      nrfScore: null,
      costPerServingCents: 400, difficultyBand: 'intermediate', totalMinutes: 30,
      categories: cats({ cuisine: ['italian'] }),
    });
    const [ranked] = engine.rank([recipe], preferences());
    expect(ranked.breakdown).not.toHaveProperty('nutrition');
    // 4 available signals (cost, difficulty, affinity, time), each weight 1.
    expect(Object.keys(ranked.breakdown)).toHaveLength(4);
  });

  it('empty available set → score 0', () => {
    const recipe = rankableRecipe({
      costPerServingCents: null, difficultyBand: null, nrfScore: null, totalMinutes: null,
    });
    const [ranked] = engine.rank([recipe], preferences());
    expect(ranked.score).toBe(0);
  });
});

describe('soft penalties stack and floor (Test Case 5)', () => {
  const engine = RankingEngine.create();

  it('subtracts mild-allergen and flexible-incompatible penalties', () => {
    const recipe = rankableRecipe({
      costPerServingCents: 400, difficultyBand: 'intermediate', nrfScore: 57, totalMinutes: 30,
      categories: cats({ cuisine: ['italian'] }),
      allergens: { contains: ['peanut'], mayContain: [], complete: true },
      dietFit: { vegan: 'incompatible' },
    });
    const prefs = preferences({
      allergens: [{ allergen: 'peanut', severity: 'mild' }],
      diets: [{ dietId: 'vegan', strictness: 'flexible' }],
    });
    // average = (1 + 1 + 0.5 + 0.5 + 1)/5 = 0.8; penalties 0.15 + 0.20.
    const [ranked] = engine.rank([recipe], prefs);
    expect(ranked.score).toBeCloseTo(0.8 - 0.15 - 0.2, 6);
  });

  it('floors at 0, never negative', () => {
    const recipe = rankableRecipe({
      costPerServingCents: 800, difficultyBand: 'advanced', nrfScore: 0, totalMinutes: 60,
      categories: cats({ cuisine: ['italian'] }),
      allergens: { contains: ['peanut'], mayContain: [], complete: true },
    });
    const prefs = preferences({
      skillLevel: 'beginner',
      foodPrefs: [fp({ facet: 'cuisine', value: 'italian', sentiment: 'dislike' })],
      allergens: [{ allergen: 'peanut', severity: 'mild' }],
    });
    const [ranked] = engine.rank([recipe], prefs);
    expect(ranked.score).toBe(0);
  });
});

describe('tie-break ordering (Test Case 6)', () => {
  const engine = RankingEngine.create();

  it('higher coverage first, then newer createdAt, then id ascending', () => {
    // Both score 1.0: perfect cost. One also has difficulty (higher coverage).
    const base = {
      costPerServingCents: 200, nrfScore: null, totalMinutes: null,
      categories: cats(),
    };
    const lowCoverage = rankableRecipe({ id: 'a', difficultyBand: null, ...base });
    const highCoverage = rankableRecipe({ id: 'b', difficultyBand: 'intermediate', ...base });
    const prefs = preferences({ weights: { cost: 1, difficulty: 1, nutrition: 0, affinity: 0, time: 0, popularity: 0, mealPrep: 0 } });
    const ranked = engine.rank([lowCoverage, highCoverage], prefs);
    expect(ranked.map((r) => r.recipeId)).toEqual(['b', 'a']);
  });

  it('equal coverage → newer createdAt, then id ascending', () => {
    const mk = (id: string, createdAt: Date) =>
      rankableRecipe({ id, createdAt, costPerServingCents: 200, difficultyBand: null, nrfScore: null, totalMinutes: null });
    const prefs = preferences({ weights: { cost: 1, difficulty: 0, nutrition: 0, affinity: 0, time: 0, popularity: 0, mealPrep: 0 } });
    const older = mk('z', new Date('2026-01-01'));
    const newer = mk('a', new Date('2026-06-01'));
    expect(engine.rank([older, newer], prefs).map((r) => r.recipeId)).toEqual(['a', 'z']);

    const same = new Date('2026-01-01');
    expect(engine.rank([mk('b', same), mk('a', same)], prefs).map((r) => r.recipeId)).toEqual(['a', 'b']);
  });
});

describe('worked-example regression (Test Case 7)', () => {
  const alice = preferences({
    userId: 'alice',
    skillLevel: 'intermediate',
    budgetCentsPerServing: 400,
    timeBudgetMinutes: 30,
    weights: { cost: 3, difficulty: 1, nutrition: 3, affinity: 2, time: 2, popularity: 0, mealPrep: 0 },
    allergens: [{ allergen: 'peanut', severity: 'severe' }],
    diets: [],
    foodPrefs: [
      fp({ facet: 'cuisine', value: 'italian', sentiment: 'like' }),
      fp({ facet: 'primary_ingredient', value: 'chicken', sentiment: 'like' }),
      fp({ facet: 'primary_ingredient', value: 'liver', sentiment: 'dislike' }),
    ],
  });

  const r1 = rankableRecipe({
    id: 'R1', createdAt: new Date('2026-01-01'),
    costPerServingCents: 350, difficultyBand: 'intermediate', nrfScore: 45, totalMinutes: 25,
    categories: cats({ cuisine: ['italian'], dishType: ['pan-fry'], primaryIngredient: ['chicken'] }),
  });
  const r2 = rankableRecipe({
    id: 'R2', createdAt: new Date('2026-01-02'),
    costPerServingCents: 500, difficultyBand: 'advanced', nrfScore: 30, totalMinutes: 40,
    categories: cats({ cuisine: ['thai'], primaryIngredient: ['shrimp'] }),
    allergens: { contains: ['peanut'], mayContain: [], complete: true },
  });
  const r3 = rankableRecipe({
    id: 'R3', createdAt: new Date('2026-01-03'),
    costPerServingCents: 250, difficultyBand: 'beginner', nrfScore: 70, totalMinutes: 45,
    categories: cats({ cuisine: ['italian'], dishType: ['soup'], primaryIngredient: ['beans'] }),
  });

  it('filters R2, orders [R1, R3], scores 81.7 and 71.2', () => {
    const ranked = RankingEngine.create().rank([r1, r2, r3], alice);
    expect(ranked.map((r) => r.recipeId)).toEqual(['R1', 'R3']);
    expect(round1(ranked[0].score)).toBe(81.7);
    expect(round1(ranked[1].score)).toBe(71.2);
  });
});

describe('meal-prep contribution (signal #10, worked example)', () => {
  const engine = RankingEngine.create();
  // Two recipes identical but for meal_prep_fit; cost is the sole other soft signal (score 1
  // at budget), so the score delta is exactly the meal-prep term. Σw = 11 (others) + weight.
  const mk = (mealPrepFit: RankableRecipe['mealPrepFit']) =>
    rankableRecipe({ costPerServingCents: 400, difficultyBand: null, nrfScore: null, totalMinutes: null, mealPrepFit });
  const prefsAt = (mealPrep: number) =>
    preferences({ weights: { cost: 11, difficulty: 0, nutrition: 0, affinity: 0, time: 0, popularity: 0, mealPrep } });

  it('a designed recipe outscores an unsuitable one by ~18 points at weight 3', () => {
    const [designed] = engine.rank([mk('designed')], prefsAt(3));
    const [unsuitable] = engine.rank([mk('unsuitable')], prefsAt(3));
    expect(designed.breakdown.mealPrep).toBe(1.0);
    expect(unsuitable.breakdown.mealPrep).toBe(0.15);
    expect(round1(designed.score) - round1(unsuitable.score)).toBeCloseTo(18.2, 1);
  });

  it('the same gap is smaller at weight 1', () => {
    const gapAt = (w: number) =>
      round1(engine.rank([mk('designed')], prefsAt(w))[0].score) - round1(engine.rank([mk('unsuitable')], prefsAt(w))[0].score);
    const gap1 = gapAt(1);
    expect(gap1).toBeGreaterThan(0);
    expect(gap1).toBeLessThan(gapAt(3));
  });

  it('drops out of the average for a null-fit recipe', () => {
    const [ranked] = engine.rank([mk(null)], prefsAt(3));
    expect(ranked.breakdown).not.toHaveProperty('mealPrep');
  });
});
