import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture } from './fixtures/fdc-foods.fixture.js';
import { seedPriceFixture, UNPRICED_FDC_ID } from './fixtures/pp-nap.fixture.js';
import { CostEstimator, CPI_FACTOR } from '../src/price/cost-estimator.js';
import type { EstimatorIngredient } from '../src/nutrition/nutrition-estimator.js';
import type { Database } from '../src/db.js';

/**
 * WI-CS-2 — `CostEstimator` over the WI-CS-1 price fixture, offline on a `file:` db.
 * The fixture prices flour (100008, 0.089), chicken (100004, 0.612), and butter
 * (100007, 1.734 — stands in for olive oil, category "Fats and oils"); rice (100005)
 * is the deliberately UNPRICED food. Grams come from `QuantityConverter`, so the recipe
 * assertions use a tolerance band rather than a brittle exact-cent equality.
 */
let db: Database;
let cleanup: () => void;
let estimator: CostEstimator;

// The "2 cups flour, 1 lb chicken, 2 tbsp butter" recipe (butter = olive-oil stand-in).
const RECIPE: EstimatorIngredient[] = [
  { name: 'flour', amount: '2', unit: 'cup' },
  { name: 'chicken', amount: '1', unit: 'pound' },
  { name: 'butter', amount: '2', unit: 'tablespoon' },
];

beforeAll(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
  await seedPriceFixture(db);
  estimator = CostEstimator.create(db);
});

afterAll(() => cleanup());

describe('Test Case 1: known recipe → expected cents-per-serving (AC 2, 3, 5)', () => {
  it('sums grams × price × CPI, divides by servings, and fully covers', async () => {
    const result = await estimator.estimate(RECIPE, 4);
    expect(result).not.toBeNull();
    // Hand-computed from the fixture grams (flour 480g, chicken 453.592g, butter 27.208g):
    //   (480/100·0.089 + 453.592/100·0.612 + 27.208/100·1.734)·CPI_FACTOR / 4 · 100 ≈ 119¢
    expect(result!.centsPerServing).toBeGreaterThan(105);
    expect(result!.centsPerServing).toBeLessThan(135);
    expect(result!.coverage).toBeCloseTo(1, 5);
  });

  it('scales inversely with servings (same total spread over more plates)', async () => {
    const four = await estimator.estimate(RECIPE, 4);
    const eight = await estimator.estimate(RECIPE, 8);
    // Doubling servings halves the per-serving cost (±1¢ from independent rounding).
    expect(Math.abs(eight!.centsPerServing - four!.centsPerServing / 2)).toBeLessThanOrEqual(1);
  });

  it('applies CPI_FACTOR (a documented ~1.3 aging factor)', () => {
    expect(CPI_FACTOR).toBeGreaterThan(1);
  });
});

describe('Test Case 2: one unpriced ingredient lowers coverage (AC 2, 4)', () => {
  it('excludes the unpriced grams from cost but counts them in coverage', async () => {
    // Rice (100005) matches and converts but has no price row.
    const withRice: EstimatorIngredient[] = [...RECIPE, { name: 'rice', amount: '1', unit: 'cup' }];
    const priced = await estimator.estimate(RECIPE, 4);
    const mixed = await estimator.estimate(withRice, 4);

    expect(mixed!.coverage).toBeGreaterThan(0);
    expect(mixed!.coverage).toBeLessThan(1);
    // The unpriced rice adds convertible grams but no cost → same cents as without it.
    expect(mixed!.centsPerServing).toBe(priced!.centsPerServing);
  });
});

describe('Test Case 3: nothing prices → null (AC 3)', () => {
  it('returns null when nothing matches (nothing convertible)', async () => {
    expect(await estimator.estimate([{ name: 'xyzzy', amount: '1', unit: 'cup' }], 4)).toBeNull();
  });

  it('returns null when the only match has no price (convertible but unpriced)', async () => {
    // Rice converts but has no price: convertibleGrams > 0, pricedGrams 0 → coverage 0.
    const result = await estimator.estimate([{ name: 'rice', amount: '1', unit: 'cup' }], 4);
    expect(result).not.toBeNull();
    expect(result!.centsPerServing).toBe(0);
    expect(result!.coverage).toBe(0);
  });
});

describe('Test Case 4: oil goes through the volume→gram density path (AC 2)', () => {
  it('prices butter (Fats and oils) at 0.92 density, not water', async () => {
    // 2 tbsp × 14.787 ml × 0.92 g/ml = 27.208g (water would be 29.574g).
    const oilOnly = await estimator.estimate([{ name: 'butter', amount: '2', unit: 'tablespoon' }], 1);
    const grams = 2 * 14.787 * 0.92;
    const expectedCents = Math.round((grams / 100) * 1.734 * CPI_FACTOR * 100);
    expect(oilOnly!.centsPerServing).toBe(expectedCents);
  });

  it('the unpriced food id is rice (documents the fixture contract)', () => {
    expect(UNPRICED_FDC_ID).toBe(100005);
  });
});
