import { describe, it, expect } from 'vitest';
import type { UserPreferences, FoodPref } from '../src/models/user-preferences.js';
import type { RankableRecipe } from '../src/ranking/types.js';
import type { LabelCoreKey } from '../src/models/label-core.js';
import { AllergenFilter, DietFilter, EquipmentFilter } from '../src/ranking/filters.js';
import { AffinityScorer } from '../src/ranking/scorers.js';
import { RankingEngine } from '../src/ranking/ranking-engine.js';

/** WI-3 — pure RankingEngine: affinity base, recipe-scope directive weight/filter, penalties, tie-breaks. */

const EMPTY_PANEL: Record<LabelCoreKey, number | null> = {
  calories: null, grams_of_fat: null, grams_of_saturated_fat: null, grams_of_carbohydrate: null,
  grams_of_fiber: null, grams_of_sugar: null, grams_of_protein: null, milligrams_of_sodium: null,
};

function rankableRecipe(overrides: Partial<RankableRecipe> = {}): RankableRecipe {
  return {
    id: 'r1',
    createdAt: new Date('2026-01-01'),
    costPerServingCents: 300,
    difficultyBand: 'intermediate',
    mealPrepFit: null,
    nrfScore: 50,
    nutrition: EMPTY_PANEL,
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

/** A recipe-scope taste directive: a like → `more`, a dislike → `less`; strength defaults soft. */
function fp(p: { facet: FoodPref['dimension']; value: string; sentiment?: 'like' | 'dislike'; direction?: 'more' | 'less'; strength?: FoodPref['strength']; target?: number; reason?: string }): FoodPref {
  const direction = p.direction ?? (p.sentiment === 'dislike' || (p.sentiment == null && p.target != null && p.target < 0) ? 'less' : 'more');
  return { dimension: p.facet, value: p.value, scope: 'recipe', direction, strength: p.strength ?? 'soft', target: p.target ?? null, unit: null, reason: p.reason ?? null };
}
/** A RankableRecipe categories bucket with foodCategory defaulting to []. */
function cats(o: Partial<RankableRecipe['categories']> = {}): RankableRecipe['categories'] {
  return { cuisine: [], dishType: [], primaryIngredient: [], foodCategory: [], ...o };
}
/** A RankableRecipe nutrition panel with one macro set (per serving). */
function panel(o: Partial<Record<LabelCoreKey, number | null>> = {}): Record<LabelCoreKey, number | null> {
  return { ...EMPTY_PANEL, ...o };
}

describe('affinity base scorer', () => {
  const p = preferences();

  it('affinity: firm like → 1, neutral → 0.5, firm dislike → 0, no categories → null; soft is halfway', () => {
    const aff = new AffinityScorer();
    const liked = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', direction: 'more', strength: 'firm' })] });
    const disliked = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', direction: 'less', strength: 'firm' })] });
    const italian = rankableRecipe({ categories: cats({ cuisine: ['italian'] }) });
    expect(aff.score(italian, liked)).toBe(1);
    expect(aff.score(italian, p)).toBe(0.5);
    expect(aff.score(italian, disliked)).toBe(0);
    expect(aff.score(rankableRecipe(), p)).toBeNull();
    // A soft directive pulls halfway: like → 0.75, dislike → 0.25.
    const softLike = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', direction: 'more', strength: 'soft' })] });
    expect(aff.score(italian, softLike)).toBe(0.75);
  });

  // O-AF-1: the ingredient facet intersects the user's picked base_ingredient_ids with the
  // recipe's rolled-up baseIngredientIds — an "okra" dislike bites at base-ingredient granularity.
  it('affinity ingredient facet: firm liked → 1, disliked → 0, no overlap → 0.5 within the four-facet mean', () => {
    const aff = new AffinityScorer();
    const okra = 'okra-uuid';
    const recipe = rankableRecipe({ categories: cats(), baseIngredientIds: [okra] });
    const liked = preferences({ foodPrefs: [fp({ facet: 'ingredient', value: okra, direction: 'more', strength: 'firm' })] });
    const disliked = preferences({ foodPrefs: [fp({ facet: 'ingredient', value: okra, direction: 'less', strength: 'firm' })] });
    expect(aff.score(recipe, liked)).toBe(1); // only facet present → mean 1 → 0.5+0.5
    expect(aff.score(recipe, disliked)).toBe(0);
    expect(aff.score(recipe, p)).toBe(0.5); // no matching pref → neutral
    // No overlap between a picked id and the recipe's ids → neutral 0.5.
    const other = preferences({ foodPrefs: [fp({ facet: 'ingredient', value: 'spinach-uuid', direction: 'less', strength: 'firm' })] });
    expect(aff.score(recipe, other)).toBe(0.5);
    // Empty baseIngredientIds → the ingredient facet contributes nothing (here: null overall).
    expect(aff.score(rankableRecipe({ baseIngredientIds: [] }), disliked)).toBeNull();
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

describe('recipe-scope directive weight (Test Case 1 — AC-1)', () => {
  const engine = RankingEngine.create();
  // A thai recipe with no other categorical signal → base affinity is the sole term.
  const thai = () => rankableRecipe({ id: 'thai', categories: cats({ cuisine: ['thai'] }) });
  const score = (prefs: UserPreferences) => engine.rank([thai()], prefs)[0].score;

  it('a soft/firm `less` lowers the score, a `more` raises it; firm bites harder', () => {
    const base = score(preferences()); // no directive: affinity 0.5

    const softLess = score(preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'thai', direction: 'less', strength: 'soft' })] }));
    const firmLess = score(preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'thai', direction: 'less', strength: 'firm' })] }));
    expect(softLess).toBeLessThan(base);
    expect(firmLess).toBeLessThan(softLess); // firm lowers it more

    const softMore = score(preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'thai', direction: 'more', strength: 'soft' })] }));
    const firmMore = score(preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'thai', direction: 'more', strength: 'firm' })] }));
    // A `more` directive raises affinity itself (thai liked → base 1.0); firm's factor caps at 1.
    expect(softMore).toBeGreaterThan(base);
    expect(firmMore).toBeGreaterThanOrEqual(softMore);
  });

  it('a food_category directive (affinity-blind) modulates both soft and firm', () => {
    const redMeat = () => rankableRecipe({ id: 'rm', categories: cats({ cuisine: ['thai'], foodCategory: ['red_meat'] }) });
    const base = engine.rank([redMeat()], preferences())[0].score; // affinity 0.5 (thai neutral)
    const softLess = engine.rank([redMeat()], preferences({ foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', direction: 'less', strength: 'soft' })] }))[0].score;
    const firmLess = engine.rank([redMeat()], preferences({ foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', direction: 'less', strength: 'firm' })] }))[0].score;
    expect(softLess).toBeLessThan(base);
    expect(firmLess).toBeLessThan(softLess);
  });

  it('a nutrient directive joins through the panel field and modulates', () => {
    const salty = () => rankableRecipe({ id: 'salty', categories: cats({ cuisine: ['thai'] }), nutrition: panel({ milligrams_of_sodium: 900 }) });
    const noPanel = () => rankableRecipe({ id: 'unknown', categories: cats({ cuisine: ['thai'] }), nutrition: panel() });
    const lessSodium = preferences({ foodPrefs: [fp({ facet: 'nutrient', value: 'sodium', direction: 'less', strength: 'firm' })] });
    const base = engine.rank([salty()], preferences())[0].score;
    // The recipe carries a sodium value → the directive bites.
    expect(engine.rank([salty()], lessSodium)[0].score).toBeLessThan(base);
    // A recipe with no sodium value → the directive can't join, score unchanged.
    expect(engine.rank([noPanel()], lessSodium)[0].score).toBeCloseTo(engine.rank([noPanel()], preferences())[0].score, 6);
  });
});

describe('strict recipe-scope directive filters (Test Case 2 — AC-2)', () => {
  const engine = RankingEngine.create();
  const redMeat = rankableRecipe({ id: 'rm', categories: cats({ cuisine: ['thai'], foodCategory: ['red_meat'] }) });
  const poultry = rankableRecipe({ id: 'chx', categories: cats({ cuisine: ['thai'], foodCategory: ['poultry'] }) });

  it('a strict `less` removes every matching recipe', () => {
    const prefs = preferences({ foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', direction: 'less', strength: 'strict' })] });
    const ranked = engine.rank([redMeat, poultry], prefs);
    expect(ranked.map((r) => r.recipeId)).toEqual(['chx']); // red-meat gone
  });

  it('a strict `more` keeps only matching recipes (require)', () => {
    const prefs = preferences({ foodPrefs: [fp({ facet: 'food_category', value: 'red_meat', direction: 'more', strength: 'strict' })] });
    const ranked = engine.rank([redMeat, poultry], prefs);
    expect(ranked.map((r) => r.recipeId)).toEqual(['rm']); // only red-meat survives
  });
});

describe('base ranking with no directives (Test Case 3 — AC-3)', () => {
  const engine = RankingEngine.create();

  it('order is affinity (+popularity) alone', () => {
    const liked = rankableRecipe({ id: 'liked', categories: cats({ cuisine: ['italian'] }) });
    const neutral = rankableRecipe({ id: 'neutral', categories: cats({ cuisine: ['thai'] }) });
    // With a single italian `more` directive, only affinity differs → liked first.
    const prefs = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', direction: 'more' })] });
    const ranked = engine.rank([neutral, liked], prefs);
    expect(ranked.map((r) => r.recipeId)).toEqual(['liked', 'neutral']);
    expect(Object.keys(ranked[0].breakdown)).toEqual(['affinity']);
  });

  it('an affinity-less recipe scores 0 (no base signal)', () => {
    const [ranked] = engine.rank([rankableRecipe({ categories: cats() })], preferences());
    expect(ranked.score).toBe(0);
    expect(ranked.breakdown).toEqual({});
  });
});

describe('equipment soft penalty layers on the base (WI-EQ-3)', () => {
  const engine = RankingEngine.create();
  // Base affinity = 0.5 (italian, no directive); the recommended-gear penalty subtracts 0.10.
  const recipe = (equipment: RankableRecipe['equipment']) =>
    rankableRecipe({ categories: cats({ cuisine: ['italian'] }), equipment, equipmentComplete: true });
  const airFryer: RankableRecipe['equipment'] = [{ equipment: 'air_fryer', essentiality: 'recommended' }];

  it('subtracts a flat 0.10 for a reviewed user missing recommended gear', () => {
    const [r] = engine.rank([recipe(airFryer)], preferences({ equipmentReviewed: true, ownedEquipment: [] }));
    expect(r.score).toBeCloseTo(0.5 - 0.1, 6);
  });
  it('no penalty when the gear is owned, or the kitchen is unreviewed', () => {
    expect(engine.rank([recipe(airFryer)], preferences({ equipmentReviewed: true, ownedEquipment: ['air_fryer'] }))[0].score).toBeCloseTo(0.5, 6);
    expect(engine.rank([recipe(airFryer)], preferences({ equipmentReviewed: false }))[0].score).toBeCloseTo(0.5, 6);
  });
});

describe('soft penalties stack and floor', () => {
  const engine = RankingEngine.create();

  it('subtracts mild-allergen and flexible-incompatible penalties off the base', () => {
    const recipe = rankableRecipe({
      categories: cats({ cuisine: ['italian'] }),
      allergens: { contains: ['peanut'], mayContain: [], complete: true },
      dietFit: { vegan: 'incompatible' },
    });
    const prefs = preferences({
      allergens: [{ allergen: 'peanut', severity: 'mild' }],
      diets: [{ dietId: 'vegan', strictness: 'flexible' }],
    });
    // base affinity 0.5; penalties 0.15 + 0.20.
    const [ranked] = engine.rank([recipe], prefs);
    expect(ranked.score).toBeCloseTo(0.5 - 0.15 - 0.2, 6);
  });

  it('floors at 0, never negative', () => {
    const recipe = rankableRecipe({
      categories: cats({ cuisine: ['italian'] }),
      allergens: { contains: ['peanut'], mayContain: [], complete: true },
    });
    const prefs = preferences({
      foodPrefs: [fp({ facet: 'cuisine', value: 'italian', direction: 'less', strength: 'firm' })],
      allergens: [{ allergen: 'peanut', severity: 'mild' }],
    });
    const [ranked] = engine.rank([recipe], prefs);
    expect(ranked.score).toBe(0);
  });
});

describe('tie-break ordering', () => {
  const engine = RankingEngine.create();

  it('equal score → newer createdAt, then id ascending', () => {
    // Same italian `more` → both affinity 1.0; tie falls to createdAt then id.
    const mk = (id: string, createdAt: Date) => rankableRecipe({ id, createdAt, categories: cats({ cuisine: ['italian'] }) });
    const prefs = preferences({ foodPrefs: [fp({ facet: 'cuisine', value: 'italian', direction: 'more' })] });
    const older = mk('z', new Date('2026-01-01'));
    const newer = mk('a', new Date('2026-06-01'));
    expect(engine.rank([older, newer], prefs).map((r) => r.recipeId)).toEqual(['a', 'z']);

    const same = new Date('2026-01-01');
    expect(engine.rank([mk('b', same), mk('a', same)], prefs).map((r) => r.recipeId)).toEqual(['a', 'b']);
  });
});

describe('worked-example regression (base = affinity)', () => {
  const alice = preferences({
    userId: 'alice',
    allergens: [{ allergen: 'peanut', severity: 'severe' }],
    foodPrefs: [
      fp({ facet: 'cuisine', value: 'italian', sentiment: 'like' }),
      fp({ facet: 'primary_ingredient', value: 'chicken', sentiment: 'like' }),
      fp({ facet: 'primary_ingredient', value: 'liver', sentiment: 'dislike' }),
    ],
  });

  const r1 = rankableRecipe({
    id: 'R1', createdAt: new Date('2026-01-01'),
    categories: cats({ cuisine: ['italian'], dishType: ['pan-fry'], primaryIngredient: ['chicken'] }),
  });
  const r2 = rankableRecipe({
    id: 'R2', createdAt: new Date('2026-01-02'),
    categories: cats({ cuisine: ['thai'], primaryIngredient: ['shrimp'] }),
    allergens: { contains: ['peanut'], mayContain: [], complete: true },
  });
  const r3 = rankableRecipe({
    id: 'R3', createdAt: new Date('2026-01-03'),
    categories: cats({ cuisine: ['italian'], dishType: ['soup'], primaryIngredient: ['beans'] }),
  });

  it('filters R2 (severe peanut) and orders [R1, R3] by affinity', () => {
    const ranked = RankingEngine.create().rank([r1, r2, r3], alice);
    expect(ranked.map((r) => r.recipeId)).toEqual(['R1', 'R3']);
    // R1 (italian + chicken liked) outscores R3 (italian liked, beans neutral).
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
