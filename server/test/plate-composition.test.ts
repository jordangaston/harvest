import { describe, it, expect } from 'vitest';
import type { FoodPref } from '../src/models/user-preferences.js';
import type { RankableRecipe } from '../src/ranking/types.js';
import type { LabelCoreKey } from '../src/models/label-core.js';
import { completePlate } from '../src/ranking/plate.js';
import { checkAggregate } from '../src/ranking/aggregate.js';

/** WI-4 — plate completion (main covers / append side) + day/week aggregate budgets. */

const EMPTY_PANEL: Record<LabelCoreKey, number | null> = {
  calories: null, grams_of_fat: null, grams_of_saturated_fat: null, grams_of_carbohydrate: null,
  grams_of_fiber: null, grams_of_sugar: null, grams_of_protein: null, milligrams_of_sodium: null,
};

function recipe(overrides: Partial<RankableRecipe> = {}): RankableRecipe {
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

/** A meal-slot / aggregate directive; strength defaults soft. */
function directive(p: Partial<FoodPref> & Pick<FoodPref, 'dimension' | 'value' | 'scope' | 'direction'>): FoodPref {
  return { strength: 'soft', target: null, unit: null, reason: null, ...p };
}

describe('completePlate — meal-slot plate rules', () => {
  const veggieDinner = directive({ dimension: 'food_category', value: 'vegetable', scope: 'dinner', direction: 'more' });

  it('adds a side_dish vegetable when the main lacks a vegetable (TC1)', () => {
    const main = recipe({ id: 'main', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: ['beef'], foodCategory: ['red_meat'] } });
    const side = recipe({ id: 'broccoli', categories: { cuisine: [], dishType: ['side_dish'], primaryIngredient: [], foodCategory: ['vegetable'] } });

    const plate = completePlate(main, [side], [veggieDinner], 'dinner');

    expect(plate.main.id).toBe('main');
    expect(plate.sides.map((s) => s.id)).toEqual(['broccoli']);
  });

  it('adds no side when the main already carries the vegetable (TC1)', () => {
    const main = recipe({ id: 'stirfry', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['vegetable'] } });
    const side = recipe({ id: 'broccoli', categories: { cuisine: [], dishType: ['side_dish'], primaryIngredient: [], foodCategory: ['vegetable'] } });

    const plate = completePlate(main, [side], [veggieDinner], 'dinner');

    expect(plate.sides).toEqual([]);
  });

  it('ignores a directive scoped to another slot', () => {
    const main = recipe({ id: 'main', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['red_meat'] } });
    const side = recipe({ id: 'broccoli', categories: { cuisine: [], dishType: ['side_dish'], primaryIngredient: [], foodCategory: ['vegetable'] } });

    // A lunch-scope rule must not complete a dinner plate.
    const plate = completePlate(main, [side], [directive({ dimension: 'food_category', value: 'vegetable', scope: 'lunch', direction: 'more' })], 'dinner');

    expect(plate.sides).toEqual([]);
  });

  it('never appends a non-side (main_course) recipe as a side', () => {
    const main = recipe({ id: 'main', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['red_meat'] } });
    // A vegetable main, not a side — must not be pulled in as a side.
    const veggieMain = recipe({ id: 'veg-main', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['vegetable'] } });

    const plate = completePlate(main, [veggieMain], [veggieDinner], 'dinner');

    expect(plate.sides).toEqual([]);
  });

  it('does not append for a `less` slot directive (a side cannot subtract)', () => {
    const main = recipe({ id: 'main', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['red_meat'] } });
    const side = recipe({ id: 'salad', categories: { cuisine: [], dishType: ['side_dish'], primaryIngredient: [], foodCategory: ['vegetable'] } });

    const plate = completePlate(main, [side], [directive({ dimension: 'food_category', value: 'vegetable', scope: 'dinner', direction: 'less' })], 'dinner');

    expect(plate.sides).toEqual([]);
  });

  it('adds one side per unmet rule, reusing a side that covers two rules', () => {
    const main = recipe({ id: 'main', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['red_meat'] } });
    // One side that is both vegetable and high-fiber (carries the fiber nutrient panel field).
    const combo = recipe({ id: 'combo', categories: { cuisine: [], dishType: ['side_dish'], primaryIngredient: [], foodCategory: ['vegetable'] }, nutrition: { ...EMPTY_PANEL, grams_of_fiber: 6 } });
    const rules = [
      veggieDinner,
      directive({ dimension: 'nutrient', value: 'fiber', scope: 'dinner', direction: 'more' }),
    ];

    const plate = completePlate(main, [combo], rules, 'dinner');

    // The first rule adds `combo`; the second is then already covered by that side — no duplicate.
    expect(plate.sides.map((s) => s.id)).toEqual(['combo']);
  });
});

describe('checkAggregate — day/week budgets', () => {
  it('day nutrient sum reports unmet when the total exceeds a `less` target (TC2)', () => {
    const meals = [
      recipe({ id: 'a', nutrition: { ...EMPTY_PANEL, grams_of_saturated_fat: 18 } }),
      recipe({ id: 'b', nutrition: { ...EMPTY_PANEL, grams_of_saturated_fat: 12 } }),
    ];
    const d = directive({ dimension: 'nutrient', value: 'saturated_fat', scope: 'day', direction: 'less', target: 20, unit: 'grams' });

    const check = checkAggregate(meals, d);

    expect(check.actual).toBe(30);
    expect(check.met).toBe(false);
  });

  it('day nutrient sum treats an absent macro as 0 and can meet a `less` target', () => {
    const meals = [
      recipe({ id: 'a', nutrition: { ...EMPTY_PANEL, grams_of_saturated_fat: 5 } }),
      recipe({ id: 'b' }), // panel absent → contributes 0
    ];
    const d = directive({ dimension: 'nutrient', value: 'saturated_fat', scope: 'day', direction: 'less', target: 20, unit: 'grams' });

    const check = checkAggregate(meals, d);

    expect(check.actual).toBe(5);
    expect(check.met).toBe(true);
  });

  it('week count reports unmet when meals bearing the value exceed a `less` target (TC3)', () => {
    const redMeat = (id: string) => recipe({ id, categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['red_meat'] } });
    const meals = [redMeat('a'), redMeat('b'), redMeat('c'), redMeat('d'), recipe({ id: 'fish', categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: ['seafood'], foodCategory: ['seafood'] } })];
    const d = directive({ dimension: 'food_category', value: 'red_meat', scope: 'week', direction: 'less', target: 3, unit: 'count' });

    const check = checkAggregate(meals, d);

    expect(check.actual).toBe(4);
    expect(check.met).toBe(false);
  });

  it('week `more` count is met when enough meals bear the value (AC-4)', () => {
    const veg = (id: string) => recipe({ id, categories: { cuisine: [], dishType: ['main_course'], primaryIngredient: [], foodCategory: ['vegetable'] } });
    const d = directive({ dimension: 'food_category', value: 'vegetable', scope: 'week', direction: 'more', target: 2, unit: 'count' });

    expect(checkAggregate([veg('a'), veg('b'), veg('c')], d).met).toBe(true);
    expect(checkAggregate([veg('a')], d).met).toBe(false);
  });

  it('throws when an aggregate directive has no target', () => {
    const d = directive({ dimension: 'food_category', value: 'red_meat', scope: 'week', direction: 'less', unit: 'count' });
    expect(() => checkAggregate([], d)).toThrow(/target/);
  });
});
