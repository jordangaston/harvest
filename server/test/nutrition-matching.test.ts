import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture, SALMON_FDC_ID } from './fixtures/fdc-foods.fixture.js';
import { FDC_NUTRIENT } from '../src/nutrition/fdc-nutrient.js';
import { FdcFoodRepository } from '../src/nutrition/fdc-food-repository.js';
import { FoodMatcher, type FoodMatch } from '../src/nutrition/food-matcher.js';
import { QuantityConverter } from '../src/nutrition/quantity-converter.js';
import type { Database } from '../src/db.js';

// Offline: everything runs against the WI-1 fixture on a migrated `file:` db. No network.

let db: Database;
let cleanup: () => void;
let repo: FdcFoodRepository;
let matcher: FoodMatcher;
let converter: QuantityConverter;

const SPINACH_FDC_ID = 100001;
const BUTTER_FDC_ID = 100007; // category "Fats and oils" → density override < 1.0
const EGG_FDC_ID = 100006; // portion "1 large"
const CHIPS_FDC_ID = 100003; // no each-portion, no per-item token → unconvertible count

beforeAll(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
  repo = FdcFoodRepository.create(db);
  matcher = FoodMatcher.create(repo);
  converter = QuantityConverter.create(repo);
});

afterAll(() => cleanup());

/** A FoodMatch stand-in for the converter tests (category drives density/per-item). */
function matchFor(fdcId: number, category: string | null): FoodMatch {
  return { fdcId, category, quality: 'high' };
}

describe('Test Case 3: FdcFoodRepository search/nutrients/portions (AC-1, AC-6)', () => {
  it('ranks salmon first for its token', async () => {
    const hits = await repo.search(['salmon']);
    expect(hits[0].fdcId).toBe(SALMON_FDC_ID);
    expect(hits[0].bm25).toBeLessThan(0); // lower = better
  });

  it('returns the salmon panel including DHA and vitamin D as numbers', async () => {
    const panel = await repo.nutrients(SALMON_FDC_ID);
    expect(panel.get(FDC_NUTRIENT.vitaminD)).toBeTypeOf('number');
    expect(panel.get(FDC_NUTRIENT.dha)).toBeTypeOf('number');
    expect(panel.get(FDC_NUTRIENT.vitaminD)).toBeGreaterThan(0);
  });

  it('returns the stored portions', async () => {
    const portions = await repo.portions(SALMON_FDC_ID);
    expect(portions.length).toBeGreaterThan(0);
    expect(portions[0].gramWeight).toBeGreaterThan(0);
  });

  it('returns [] for a token that tokenizes to nothing', async () => {
    expect(await repo.search([])).toEqual([]);
  });
});

describe('Test Case 1: FoodMatcher tiers a clean hit, a typo hit, and a miss (AC-2, AC-4)', () => {
  it('matches a clean name at high quality', async () => {
    const m = await matcher.match('fresh spinach');
    expect(m).not.toBeNull();
    expect(m!.fdcId).toBe(SPINACH_FDC_ID);
    expect(m!.quality).toBe('high');
  });

  it('matches "salmon fillet" to salmon at high quality', async () => {
    const m = await matcher.match('salmon fillet, skin on');
    expect(m!.fdcId).toBe(SALMON_FDC_ID);
    expect(m!.quality).toBe('high');
  });

  // Typo hit: the fixture has no mozzarella (the spec's example food), so we use a real
  // fixture typo — "spinnach" (extra n) — which trigram OR-search still resolves to spinach.
  it('matches a typo to the right food (any non-null tier)', async () => {
    const m = await matcher.match('spinnach');
    expect(m).not.toBeNull();
    expect(m!.fdcId).toBe(SPINACH_FDC_ID);
  });

  it('returns null for gibberish', async () => {
    expect(await matcher.match('xyzzy nonexistent')).toBeNull();
  });
});

describe('Test Case 2: QuantityConverter mass/volume/count/unconvertible (AC-3, AC-5)', () => {
  it('mass is exact and high quality', async () => {
    expect(await converter.toGrams('100', 'g', matchFor(SPINACH_FDC_ID, 'Vegetables, dark green'))).toEqual({
      grams: 100,
      quality: 'high',
    });
  });

  it('volume uses the water default for an unknown category (medium)', async () => {
    const r = await converter.toGrams('1', 'cup', matchFor(SPINACH_FDC_ID, 'Vegetables, dark green'));
    expect(r).toEqual({ grams: 240, quality: 'medium' }); // 240 ml × 1.0
  });

  it('volume uses a category density override for oil (< water result)', async () => {
    const water = await converter.toGrams('1', 'cup', matchFor(SPINACH_FDC_ID, 'Vegetables, dark green'));
    const oil = await converter.toGrams('1', 'cup', matchFor(BUTTER_FDC_ID, 'Fats and oils'));
    expect(oil!.quality).toBe('medium');
    expect(oil!.grams).toBeLessThan(water!.grams);
  });

  it('count uses a matching each/large portion (low)', async () => {
    const r = await converter.toGrams('2', null, matchFor(EGG_FDC_ID, 'Eggs'));
    expect(r).toEqual({ grams: 100, quality: 'low' }); // 2 × the "1 large" 50g portion
  });

  it('count with no portion and no per-item entry is unconvertible → null', async () => {
    expect(await converter.toGrams('1', null, matchFor(CHIPS_FDC_ID, 'Savory snacks'))).toBeNull();
  });

  it('an unrecognized unit → null', async () => {
    expect(await converter.toGrams('1', 'handful', matchFor(SPINACH_FDC_ID, 'Vegetables, dark green'))).toBeNull();
  });

  it('a missing/non-numeric amount → null', async () => {
    expect(await converter.toGrams(null, 'g', matchFor(SPINACH_FDC_ID, null))).toBeNull();
  });
});
