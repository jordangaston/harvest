import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture } from './fixtures/fdc-foods.fixture.js';
import { DietClassifier } from '../src/diet/diet-classifier.js';
import { parseIngredientLine, type StructuredIngredient } from '../src/parse/ingredient.js';
import { LABEL_CORE_KEYS, type LabelCoreText } from '../src/models/label-core.js';
import type { DietCompat } from '../src/diet/diet.js';
import type { Database } from '../src/db.js';

// Offline: real DietClassifier over the WI-1 FDC fixture on a migrated `file:` db. No network.

let db: Database;
let cleanup: () => void;
let classifier: DietClassifier;

function ings(...lines: string[]): StructuredIngredient[] {
  return lines.map(parseIngredientLine);
}

/** A full per-serving label core with the given carbs/fiber/calories (others 0). */
function published(carbs: number, fiber: number, calories = 200): LabelCoreText {
  const out = {} as LabelCoreText;
  for (const key of LABEL_CORE_KEYS) out[key] = '0';
  out.grams_of_carbohydrate = String(carbs);
  out.grams_of_fiber = String(fiber);
  out.calories = String(calories);
  return out;
}

beforeAll(async () => {
  ({ db, cleanup } = await migratedFileDb());
  await seedFdcFixture(db);
  classifier = DietClassifier.create(db);
});

afterAll(() => cleanup());

describe('Test Case 1: exclusion by food-class (AC-4)', () => {
  it('a red-meat + dairy dish blocks vegan/vegetarian (bacon) and dairy_free (cheese)', async () => {
    const r = (await classifier.classify(ings('4 slices bacon', '2 cups spinach', '1 cup cheddar cheese'), 2))!;
    expect(r.fit.vegetarian).toBe('incompatible');
    expect(r.fit.vegan).toBe('incompatible');
    expect(r.blockers.vegan.value).toMatch(/bacon/);
    expect(r.blockers.vegan.class).toBe('red_meat');
    expect(r.fit.dairy_free).toBe('incompatible');
    expect(r.blockers.dairy_free.value).toMatch(/cheese/);
    expect(r.fit.pescatarian).toBe('incompatible'); // contains meat
    expect(r.coverageComplete).toBe(true);
  });

  it('a plant-only dish blocks carnivore but passes vegan/vegetarian', async () => {
    const r = (await classifier.classify(ings('2 cups spinach', '1 cup rice'), 2))!;
    expect(r.fit.vegan).toBe('compatible');
    expect(r.fit.vegetarian).toBe('compatible');
    expect(r.fit.carnivore).toBe('incompatible');
  });
});

describe('Test Case 2: hidden animal ingredient (AC-4, D-03)', () => {
  it('worcestershire blocks vegetarian with no obvious meat; cheese blocks dairy_free', async () => {
    const r = (await classifier.classify(ings('2 cups spinach', '1 cup parmesan cheese', '1 tbsp worcestershire sauce'), 2))!;
    expect(r.fit.vegetarian).toBe('incompatible');
    expect(r.blockers.vegetarian.class).toBe('hidden');
    expect(r.blockers.vegetarian.value).toMatch(/worcestershire/);
    expect(r.fit.dairy_free).toBe('incompatible');
  });
});

describe('Test Case 3: keto by net carbs (AC-5)', () => {
  it('low net carbs → keto compatible; high → incompatible; no basis → unknown', async () => {
    const low = (await classifier.classify(ings('2 cups spinach'), 1, published(5, 1)))!;
    expect(low.fit.keto).toBe('compatible');

    const high = (await classifier.classify(ings('2 cups spinach'), 1, published(50, 2)))!;
    expect(high.fit.keto).toBe('incompatible');
    expect(high.blockers.keto.kind).toBe('macro');

    const noMacro = (await classifier.classify(ings('xyzzy unknownfood'), 1))!;
    expect(noMacro.fit.keto).toBe('unknown');
  });
});

describe('Test Case 4: coverage fail-safe (AC-4, D-04)', () => {
  it('unmatched ingredients make a clean recipe unknown, never a false compatible', async () => {
    const r = (await classifier.classify(ings('2 cups spinach', '3 sprigs zzzq unknownherb', '1 dash qqxx mystery'), 4))!;
    expect(r.coverageComplete).toBe(false);
    expect(r.fit.vegan).toBe('unknown');
    expect(r.fit.vegetarian).toBe('unknown');
    // But a found blocker is still definitive despite incomplete coverage.
    expect(r.fit.carnivore).toBe('incompatible');
  });
});

describe('Test Case: withheld', () => {
  it('returns null for an empty ingredient list', async () => {
    expect(await classifier.classify([], 4)).toBeNull();
  });
});
