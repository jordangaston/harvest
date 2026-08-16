import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture } from './fixtures/fdc-foods.fixture.js';
import { FDC_NUTRIENT } from '../src/nutrition/fdc-nutrient.js';
import { nrfScore } from '../src/nutrition/nrf-score.js';
import { NutritionEstimator } from '../src/nutrition/nutrition-estimator.js';
import type { LabelCoreText } from '../src/models/label-core.js';
import type { Database } from '../src/db.js';

// Offline: the estimator runs against the WI-1 fixture on a migrated `file:` db. No network.

const N = FDC_NUTRIENT;

describe('nrfScore (AC-3)', () => {
  it('returns null when calories are zero or negative (no per-100-kcal basis)', () => {
    const panel = new Map([[N.protein, 20]]);
    expect(nrfScore(panel, 0)).toBeNull();
    expect(nrfScore(panel, -5)).toBeNull();
  });

  it('caps each encourage term at 100 %DV', () => {
    // Protein DV is 50 g; 500 g is 1000 %DV but the term caps at 100.
    const capped = nrfScore(new Map([[N.protein, 500]]), 100);
    const atCap = nrfScore(new Map([[N.protein, 50]]), 100); // exactly 100 %DV
    expect(capped).toBe(atCap);
  });

  it('treats an absent nutrient as neutral (equals the same panel with it set to 0)', () => {
    const withKey = nrfScore(new Map([[N.protein, 20], [N.fiber, 0]]), 100);
    const without = nrfScore(new Map([[N.protein, 20]]), 100);
    expect(withKey).toBe(without);
  });

  it('scores nutrient-dense salmon above calorie-dense chips', () => {
    const salmon = new Map([
      [N.calories, 206], [N.protein, 22], [N.saturatedFat, 2.5], [N.sodium, 61],
      [N.vitaminD, 11], [N.dha, 1.1], [N.epa, 0.7],
    ]);
    const chips = new Map([
      [N.calories, 536], [N.protein, 7], [N.saturatedFat, 3.1], [N.carbohydrate, 53],
      [N.fiber, 4.4], [N.sugar, 0.6], [N.sodium, 525],
    ]);
    expect(nrfScore(salmon, 206)!).toBeGreaterThan(nrfScore(chips, 536)!);
  });
});

describe('NutritionEstimator.run (AC-4)', () => {
  let db: Database;
  let cleanup: () => void;
  let estimator: NutritionEstimator;

  beforeAll(async () => {
    ({ db, cleanup } = await migratedFileDb());
    await seedFdcFixture(db);
    estimator = NutritionEstimator.create(db);
  });

  afterAll(() => cleanup());

  const SPINACH = { name: 'spinach', amount: '200', unit: 'g' };
  const SALMON = { name: 'salmon', amount: '100', unit: 'g' };

  it('estimates per-serving macros and a score when unparsed', async () => {
    const result = await estimator.run([SPINACH, SALMON], 2);
    expect(result.nutrition?.estimated).toBe(true);
    expect(result.nrfScore).toBeTypeOf('number');
    // spinach 23 kcal/100g × 200g + salmon 206 × 100g = 46 + 206 = 252 kcal, ÷ 2 = 126.
    expect(Number(result.nutrition!.values.calories)).toBeCloseTo(126, 5);
    // protein: 2.9×2 + 22×1 = 27.8, ÷ 2 = 13.9.
    expect(Number(result.nutrition!.values.grams_of_protein)).toBeCloseTo(13.9, 5);
  });

  it('excludes an unmatched ingredient rather than guessing', async () => {
    const base = await estimator.run([SPINACH, SALMON], 2);
    const withNoise = await estimator.run([SPINACH, SALMON, { name: 'xyzzy', amount: '1', unit: 'g' }], 2);
    expect(withNoise.nutrition!.values).toEqual(base.nutrition!.values);
    expect(withNoise.nrfScore).toBe(base.nrfScore);
  });

  it('withholds entirely when nothing matches', async () => {
    expect(await estimator.run([{ name: 'xyzzy', amount: '1', unit: 'g' }], 2)).toEqual({});
  });

  it('withholds the estimate when there are no servings and no parsed nutrition', async () => {
    const result = await estimator.run([SPINACH, SALMON], null);
    expect(result.nutrition).toBeUndefined();
    expect(result.nrfScore).toBeTypeOf('number'); // still scored (calories exist)
  });

  it('keeps parsed macros untouched but still scores', async () => {
    const parsed: LabelCoreText = {
      calories: '500', grams_of_fat: '20', grams_of_saturated_fat: '5',
      grams_of_carbohydrate: '40', grams_of_fiber: '6', grams_of_sugar: '8',
      grams_of_protein: '30', milligrams_of_sodium: '600',
    };
    const result = await estimator.run([SPINACH, SALMON], 2, parsed);
    expect(result.nutrition?.estimated).toBe(false);
    expect(result.nutrition?.values).toEqual(parsed);
    expect(result.nrfScore).toBeTypeOf('number');
  });
});
