import { describe, it, expect } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { normalize } from '../src/nutrition/normalize.js';
import { FDC_NUTRIENT, labelCoreForFdcNumber, LABEL_CORE_TO_FDC_NUMBER } from '../src/nutrition/fdc-nutrient.js';
import { LABEL_CORE_KEYS } from '../src/models/label-core.js';
import { insertFdcFoods } from '../scripts/build-fdc-catalog.js';
import { FDC_FIXTURE, SALMON_FDC_ID, seedFdcFixture } from './fixtures/fdc-foods.fixture.js';

describe('Test Case 1: migrations apply on a fresh db (AC-1/2/3)', () => {
  it('creates both tables, the norm index, the FTS5 mirror and its triggers', async () => {
    const { client, cleanup } = await migratedFileDb();
    try {
      const names = new Set(
        (await client.execute("SELECT name FROM sqlite_master WHERE name LIKE 'fdc%'")).rows.map((r) => String(r.name)),
      );
      for (const expected of [
        'fdc_foods',
        'fdc_food_nutrient',
        'fdc_foods_norm_idx',
        'fdc_foods_fts',
        'fdc_foods_fts_ai',
        'fdc_foods_fts_ad',
        'fdc_foods_fts_au',
      ]) {
        expect(names.has(expected)).toBe(true);
      }
    } finally {
      cleanup();
    }
  });
});

describe('Test Case 2: normalize() drop/keep cases (AC-4)', () => {
  it('shares tokens across descriptor variants', () => {
    const a = normalize('all-purpose flour, sifted');
    const b = normalize('Flour, wheat, all-purpose, unenriched');
    expect(a).toContain('flour');
    expect(b).toContain('flour');
    expect(a).not.toContain('sifted');
  });

  it('drops parentheticals, prep words, and singularizes', () => {
    expect(normalize('butter (unsalted)')).not.toContain('unsalted');
    expect(normalize('chopped onion')).not.toContain('chopped');
    expect(normalize('eggs')).toContain('egg');
  });

  it('never empties a genuine food name', () => {
    expect(normalize('fresh cheese')).toContain('cheese');
    expect(normalize('to taste').length).toBeGreaterThan(0);
  });
});

describe('Test Case 3: FDC_NUTRIENT maps the eight macros (AC-5)', () => {
  it('maps every label-core key to a number and back', () => {
    for (const key of LABEL_CORE_KEYS) {
      const number = LABEL_CORE_TO_FDC_NUMBER[key];
      expect(number).toBeTruthy();
      expect(labelCoreForFdcNumber(number)).toBe(key);
    }
  });

  it('maps representative numbers back to label-core keys', () => {
    expect(labelCoreForFdcNumber('208')).toBe('calories');
    expect(labelCoreForFdcNumber('203')).toBe('grams_of_protein');
    expect(labelCoreForFdcNumber('307')).toBe('milligrams_of_sodium');
  });

  it('defines the NRF extras', () => {
    expect(FDC_NUTRIENT.vitaminD).toBe('328');
    expect(FDC_NUTRIENT.dha).toBe('621');
    expect(FDC_NUTRIENT.epa).toBe('629');
  });
});

describe('Test Case 4: fixture seeds and is queryable, FTS5 match works (AC-7/8)', () => {
  it('seeds the counts, salmon panel, and finds salmon by MATCH', async () => {
    const { client, db, cleanup } = await migratedFileDb();
    try {
      await seedFdcFixture(db);

      const foodCount = Number((await client.execute('SELECT count(*) AS n FROM fdc_foods')).rows[0].n);
      const nutrientCount = Number((await client.execute('SELECT count(*) AS n FROM fdc_food_nutrient')).rows[0].n);
      expect(foodCount).toBe(FDC_FIXTURE.length);
      expect(nutrientCount).toBe(FDC_FIXTURE.reduce((sum, f) => sum + f.nutrients.length, 0));

      const salmonNutrients = new Set(
        (
          await client.execute({
            sql: 'SELECT nutrient_number FROM fdc_food_nutrient WHERE fdc_id = ?',
            args: [SALMON_FDC_ID],
          })
        ).rows.map((r) => String(r.nutrient_number)),
      );
      expect(salmonNutrients.has(FDC_NUTRIENT.dha)).toBe(true);
      expect(salmonNutrients.has(FDC_NUTRIENT.vitaminD)).toBe(true);

      const match = await client.execute("SELECT rowid FROM fdc_foods_fts WHERE fdc_foods_fts MATCH 'salmon'");
      expect(match.rows.map((r) => Number(r.rowid))).toContain(SALMON_FDC_ID);
    } finally {
      cleanup();
    }
  });
});

describe('Test Case 5: seed insert is idempotent (AC-6)', () => {
  it('yields identical row counts after a second run', async () => {
    const { client, db, cleanup } = await migratedFileDb();
    try {
      const count = async () => ({
        foods: Number((await client.execute('SELECT count(*) AS n FROM fdc_foods')).rows[0].n),
        nutrients: Number((await client.execute('SELECT count(*) AS n FROM fdc_food_nutrient')).rows[0].n),
      });

      await insertFdcFoods(db, FDC_FIXTURE);
      const first = await count();
      await insertFdcFoods(db, FDC_FIXTURE);
      const second = await count();

      expect(second).toEqual(first);
    } finally {
      cleanup();
    }
  });
});
