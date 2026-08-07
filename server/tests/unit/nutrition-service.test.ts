import { describe, it, expect } from 'vitest';
import { NutritionService } from '../../src/services/nutrition-service.js';
import { FoodCatalog, type Food } from '../../src/nutrition/food-catalog.js';
import { zeroLabelCore, type LabelCore } from '../../src/nutrition/label-core.js';
import type { StructuredIngredient } from '../../src/parse/ingredient.js';

const per = (o: Partial<LabelCore>): LabelCore => ({ ...zeroLabelCore(), ...o });

// Portions are cup = 100 g so grams = amount × 100 and macros = per100g × amount.
const FOODS: Food[] = [
  { name: 'flour', aliases: [], per100g: per({ calories: 364, grams_of_carbohydrate: 76 }), portions: [{ unit: 'cup', grams: 100 }] },
  { name: 'butter', aliases: [], per100g: per({ calories: 717, grams_of_fat: 81 }), portions: [{ unit: 'cup', grams: 100 }] },
];
const svc = new NutritionService(new FoodCatalog(FOODS));

const ing = (name: string, amount: string | null): StructuredIngredient => ({ name, amount, unit: 'cup', quantityText: `${amount} cup ${name}` });

describe('NutritionService.compute', () => {
  it('sums matched ingredients per serving and marks the source computed', () => {
    const result = svc.compute([ing('flour', '2'), ing('butter', '1')], 2);
    expect(result?.source).toBe('computed');
    // (364×2 + 717×1)/2 = 722.5 kcal; carbs 76×2/2 = 76; fat 81×1/2 = 40.5
    expect(result?.values.calories).toBe('722.5');
    expect(result?.values.grams_of_carbohydrate).toBe('76');
    expect(result?.values.grams_of_fat).toBe('40.5');
  });

  it('still computes at the coverage floor (2 of 3 matched ≥ 0.6)', () => {
    const result = svc.compute([ing('flour', '1'), ing('butter', '1'), ing('quinoa', '1')], 1);
    expect(result?.source).toBe('computed');
  });

  it('returns null below the coverage floor (1 of 3 matched < 0.6)', () => {
    const result = svc.compute([ing('flour', '1'), ing('quinoa', '1'), ing('kale', '1')], 1);
    expect(result).toBeNull();
  });

  it('treats an amount-less ingredient as uncovered', () => {
    expect(svc.compute([ing('flour', null)], 1)).toBeNull();
  });

  it('returns null for an empty ingredient list', () => {
    expect(svc.compute([], 4)).toBeNull();
  });
});
