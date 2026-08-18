import { describe, it, expect } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture } from './fixtures/fdc-foods.fixture.js';
import {
  seedPriceFixture,
  PP_NAP_FIXTURE,
  FIXTURE_FOOD_CODE_TO_FDC_ID,
  FIXTURE_FOOD_CODES,
} from './fixtures/pp-nap.fixture.js';
import { toPriceRows } from '../src/price/price-catalog.js';

describe('Test Case 1: migration creates the price table and recipe columns (AC 1/2/3)', () => {
  it('creates fdc_food_price with the five columns and adds the two recipe cost columns', async () => {
    const { client, cleanup } = await migratedFileDb();
    try {
      const price = (await client.execute('PRAGMA table_info(fdc_food_price)')).rows;
      const priceCols = new Map(price.map((r) => [String(r.name), r]));
      expect([...priceCols.keys()].sort()).toEqual(
        ['fdc_id', 'food_code', 'method', 'price_per_100g', 'source_cycle'].sort(),
      );
      expect(Number(priceCols.get('fdc_id')!.pk)).toBe(1);
      expect(Number(priceCols.get('food_code')!.notnull)).toBe(1);
      expect(Number(priceCols.get('price_per_100g')!.notnull)).toBe(1);
      expect(Number(priceCols.get('source_cycle')!.notnull)).toBe(1);
      expect(Number(priceCols.get('method')!.notnull)).toBe(0);

      const recipe = new Map(
        (await client.execute('PRAGMA table_info(recipes)')).rows.map((r) => [String(r.name), r]),
      );
      expect(recipe.get('cost_per_serving_cents')!.type).toBe('INTEGER');
      expect(Number(recipe.get('cost_per_serving_cents')!.notnull)).toBe(0);
      expect(recipe.get('cost_coverage')!.type).toBe('TEXT');
      expect(Number(recipe.get('cost_coverage')!.notnull)).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('is backwards-compatible: a recipe insert without the cost columns still works', async () => {
    const { client, cleanup } = await migratedFileDb();
    try {
      await client.execute({
        sql: 'INSERT INTO users (id, phone, jwt_private_key, jwt_public_key, created_at) VALUES (?, ?, ?, ?, ?)',
        args: ['u1', '+15550000000', 'priv', 'pub', Date.now()],
      });
      await client.execute({
        sql: 'INSERT INTO recipes (id, user_id, title, source_type, created_at) VALUES (?, ?, ?, ?, ?)',
        args: ['r1', 'u1', 'Old recipe', 'website', Date.now()],
      });
      const row = (
        await client.execute({ sql: 'SELECT cost_per_serving_cents, cost_coverage FROM recipes WHERE id = ?', args: ['r1'] })
      ).rows[0];
      expect(row.cost_per_serving_cents).toBeNull();
      expect(row.cost_coverage).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('Test Case 2: seed joins food_code → fdc_id and stores raw price (AC 4/6)', () => {
  it('writes one row per matched code with the fdc_id and verbatim price; skips the unmatched code', async () => {
    const { rows, skipped } = toPriceRows(PP_NAP_FIXTURE, FIXTURE_FOOD_CODE_TO_FDC_ID);
    expect(rows).toHaveLength(3);
    expect(skipped).toBe(1);

    for (const r of rows) {
      const expectedFdcId = FIXTURE_FOOD_CODE_TO_FDC_ID.get(r.foodCode);
      expect(r.fdcId).toBe(expectedFdcId);
      const source = PP_NAP_FIXTURE.find((p) => p.foodCode === r.foodCode)!;
      expect(r.pricePer100g).toBe(source.price100gm); // raw string, unmodified
      expect(r.sourceCycle).toBe('2017-2018');
    }
  });

  it('persists exactly the matched rows into fdc_food_price', async () => {
    const { client, db, cleanup } = await migratedFileDb();
    try {
      await seedFdcFixture(db);
      await seedPriceFixture(db);

      const rows = (await client.execute('SELECT fdc_id, food_code, price_per_100g FROM fdc_food_price ORDER BY fdc_id')).rows;
      expect(rows).toHaveLength(3);

      const flour = rows.find((r) => Number(r.fdc_id) === 100008)!;
      expect(String(flour.food_code)).toBe(FIXTURE_FOOD_CODES[100008]);
      expect(String(flour.price_per_100g)).toBe('0.089');

      // The unmatched PP-NAP code (99999999) produced no row.
      const codes = new Set(rows.map((r) => String(r.food_code)));
      expect(codes.has('99999999')).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe('Test Case 3: seed is idempotent (AC 5)', () => {
  it('leaves the row count unchanged on a second run', async () => {
    const { client, db, cleanup } = await migratedFileDb();
    try {
      await seedFdcFixture(db);
      const count = async () => Number((await client.execute('SELECT count(*) AS n FROM fdc_food_price')).rows[0].n);

      await seedPriceFixture(db);
      const first = await count();
      await seedPriceFixture(db);
      const second = await count();

      expect(first).toBe(3);
      expect(second).toBe(first);
    } finally {
      cleanup();
    }
  });
});
