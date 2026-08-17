import { describe, it, expect, afterEach } from 'vitest';
import { normalize } from '../src/nutrition/normalize.js';
import {
  toAllergenRows,
  seedAllergenCatalog,
  ALLERGEN_OVERRIDES,
} from '../src/allergen/allergen-catalog.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture } from './fixtures/fdc-foods.fixture.js';

/** Builds a synthetic FDC food whose `descriptionNormalized` uses the real chokepoint. */
function food(fdcId: number, category: string | null, description: string) {
  return { fdcId, category, descriptionNormalized: normalize(description).join(' ') };
}

describe('toAllergenRows', () => {
  afterEach(() => {
    for (const k of Object.keys(ALLERGEN_OVERRIDES)) delete ALLERGEN_OVERRIDES[Number(k)];
  });

  it('maps a category to its base allergen (Test Case 1)', () => {
    expect(toAllergenRows(food(1, 'Cheese', 'Cheese, cheddar'))).toEqual([
      { fdcId: 1, allergen: 'milk', presence: 'contains', species: undefined },
    ]);
  });

  it('refines "Nuts and seeds" to a tree_nut species (Test Case 2)', () => {
    const rows = toAllergenRows(food(2, 'Nuts and seeds', 'Cashews, dry roasted'));
    expect(rows).toContainEqual(
      expect.objectContaining({ allergen: 'tree_nut', presence: 'contains', species: 'cashew' }),
    );
  });

  it('lets an override win over a rule (Test Case 3)', () => {
    // An almond-milk food would map to milk by category; the override makes it tree_nut.
    ALLERGEN_OVERRIDES[42] = [
      { allergen: 'tree_nut', presence: 'contains', species: 'almond' },
      { allergen: 'milk', presence: 'contains', remove: true },
    ];
    const rows = toAllergenRows(food(42, 'Milk', 'Almond milk, unsweetened'));
    expect(rows.map((r) => r.allergen)).toEqual(['tree_nut']);
    expect(rows[0].species).toBe('almond');
  });

  it('returns [] for a food with no allergen (Test Case 4)', () => {
    expect(toAllergenRows(food(3, 'Vegetables', 'Carrots, raw'))).toEqual([]);
  });

  it('scans description for sesame and peanut (no dedicated category)', () => {
    expect(toAllergenRows(food(4, 'Vegetables', 'Hummus, with tahini')).map((r) => r.allergen)).toEqual(['sesame']);
    expect(toAllergenRows(food(5, 'Candy', 'Peanut brittle')).map((r) => r.allergen)).toEqual(['peanut']);
  });
});

describe('seedAllergenCatalog', () => {
  it('is idempotent — the row count is stable across runs (Test Case 5)', async () => {
    const { client, db, cleanup } = await migratedFileDb();
    try {
      await seedFdcFixture(db);

      await seedAllergenCatalog(db);
      const first = (await client.execute('SELECT count(*) AS c FROM fdc_food_allergen')).rows[0].c;

      await seedAllergenCatalog(db);
      const second = (await client.execute('SELECT count(*) AS c FROM fdc_food_allergen')).rows[0].c;

      expect(second).toBe(first);
    } finally {
      cleanup();
    }
  });
});
