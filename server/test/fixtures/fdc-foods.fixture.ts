import type { Database } from '../../src/db.js';
import { insertFdcFoods, toFdcFoodRow, type FdcFoodRow } from '../../scripts/build-fdc-catalog.js';
import { FDC_NUTRIENT } from '../../src/nutrition/fdc-nutrient.js';

/**
 * A hand-written ~12-food slice of FNDDS for offline tests (WI-1/2/3). Values are
 * plausible per-100g amounts, not exact USDA figures — tests must not assert third-party
 * data. Built through `toFdcFoodRow` so `description_normalized` uses the real chokepoint.
 * Salmon carries DHA/EPA/vitamin D; potato chips are the fatty/salty case; spinach is produce.
 */

const N = FDC_NUTRIENT;

/** Builds a nutrient panel from a {symbolic: amount} map (uses the FDC_NUTRIENT numbers). */
function panel(amounts: Partial<Record<keyof typeof FDC_NUTRIENT, number>>) {
  return Object.entries(amounts).map(([key, amount]) => ({
    number: FDC_NUTRIENT[key as keyof typeof FDC_NUTRIENT],
    amount: amount as number,
  }));
}

const RAW: Array<{
  fdcId: number;
  description: string;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodPortions?: { portionDescription?: string; gramWeight?: number }[];
  foodNutrients: { amount: number; nutrient: { number: string } }[];
}> = [
  {
    fdcId: 100001,
    description: 'Spinach, raw',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Vegetables, dark green' },
    foodPortions: [{ portionDescription: '1 cup', gramWeight: 30 }],
    foodNutrients: panel({ calories: 23, protein: 2.9, fat: 0.4, carbohydrate: 3.6, fiber: 2.2, sugar: 0.4, sodium: 79 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
  {
    fdcId: 100002,
    description: 'Salmon, Atlantic, cooked',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Fish' },
    foodPortions: [{ portionDescription: '1 fillet', gramWeight: 154 }],
    foodNutrients: panel({
      calories: 206,
      protein: 22,
      fat: 12,
      saturatedFat: 2.5,
      sodium: 61,
      vitaminD: 11,
      dha: 1.1,
      epa: 0.7,
    }).map((n) => ({ amount: n.amount, nutrient: { number: n.number } })),
  },
  {
    fdcId: 100003,
    description: 'Potato chips, salted',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Savory snacks' },
    foodPortions: [{ portionDescription: '1 oz', gramWeight: 28 }],
    foodNutrients: panel({ calories: 536, protein: 7, fat: 35, saturatedFat: 3.1, carbohydrate: 53, fiber: 4.4, sugar: 0.6, sodium: 525 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
  {
    fdcId: 100004,
    description: 'Chicken, breast, roasted',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Poultry' },
    foodPortions: [{ portionDescription: '1 breast', gramWeight: 172 }],
    foodNutrients: panel({ calories: 165, protein: 31, fat: 3.6, saturatedFat: 1, sodium: 74 }).map((n) => ({
      amount: n.amount,
      nutrient: { number: n.number },
    })),
  },
  {
    fdcId: 100005,
    description: 'Rice, white, cooked',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Grains' },
    foodPortions: [{ portionDescription: '1 cup', gramWeight: 158 }],
    foodNutrients: panel({ calories: 130, protein: 2.7, fat: 0.3, carbohydrate: 28, fiber: 0.4, sodium: 1 }).map((n) => ({
      amount: n.amount,
      nutrient: { number: n.number },
    })),
  },
  {
    fdcId: 100006,
    description: 'Egg, whole, cooked',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Eggs' },
    foodPortions: [{ portionDescription: '1 large', gramWeight: 50 }],
    foodNutrients: panel({ calories: 155, protein: 13, fat: 11, saturatedFat: 3.3, sodium: 124 }).map((n) => ({
      amount: n.amount,
      nutrient: { number: n.number },
    })),
  },
  {
    fdcId: 100007,
    description: 'Butter, unsalted',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Fats and oils' },
    foodPortions: [{ portionDescription: '1 tbsp', gramWeight: 14 }],
    foodNutrients: panel({ calories: 717, protein: 0.9, fat: 81, saturatedFat: 51, sodium: 11 }).map((n) => ({
      amount: n.amount,
      nutrient: { number: n.number },
    })),
  },
  {
    fdcId: 100008,
    description: 'Flour, wheat, all-purpose',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Grains' },
    foodPortions: [{ portionDescription: '1 cup', gramWeight: 125 }],
    foodNutrients: panel({ calories: 364, protein: 10, fat: 1, carbohydrate: 76, fiber: 2.7, sugar: 0.3, sodium: 2 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
  {
    fdcId: 100009,
    description: 'Onion, raw',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Vegetables, other' },
    foodPortions: [{ portionDescription: '1 cup chopped', gramWeight: 160 }],
    foodNutrients: panel({ calories: 40, protein: 1.1, fat: 0.1, carbohydrate: 9.3, fiber: 1.7, sugar: 4.2, sodium: 4 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
  {
    fdcId: 100010,
    description: 'Milk, whole',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Milk' },
    foodPortions: [{ portionDescription: '1 cup', gramWeight: 244 }],
    foodNutrients: panel({ calories: 61, protein: 3.2, fat: 3.3, saturatedFat: 1.9, carbohydrate: 4.8, sugar: 5.1, sodium: 43, vitaminD: 1.3 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
  {
    fdcId: 100011,
    description: 'Tomato, red, ripe, raw',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Vegetables, red and orange' },
    foodPortions: [{ portionDescription: '1 medium', gramWeight: 123 }],
    foodNutrients: panel({ calories: 18, protein: 0.9, fat: 0.2, carbohydrate: 3.9, fiber: 1.2, sugar: 2.6, sodium: 5 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
  {
    fdcId: 100012,
    description: 'Cheese, cheddar',
    wweiaFoodCategory: { wweiaFoodCategoryDescription: 'Cheese' },
    foodPortions: [{ portionDescription: '1 slice', gramWeight: 28 }],
    foodNutrients: panel({ calories: 403, protein: 25, fat: 33, saturatedFat: 21, carbohydrate: 1.3, sodium: 621 }).map(
      (n) => ({ amount: n.amount, nutrient: { number: n.number } }),
    ),
  },
];

/** The catalog rows, built through the seed's own mapping (single normalization chokepoint). */
export const FDC_FIXTURE: FdcFoodRow[] = RAW.map(toFdcFoodRow);

/** The salmon fixture id — the one carrying DHA/EPA/vitamin D (used by search + panel tests). */
export const SALMON_FDC_ID = 100002;

/** Inserts the fixture into a migrated db. Reused by WI-2/WI-3 tests. */
export async function seedFdcFixture(db: Database): Promise<void> {
  await insertFdcFoods(db, FDC_FIXTURE);
}
