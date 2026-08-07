import { describe, it, expect, afterAll } from 'vitest';
import { Client } from 'pg';
import { buildApp } from '../../src/api/app.js';
import { pool } from '../../src/db/index.js';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/harvest';

afterAll(async () => {
  await pool.end();
});

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('migrations create the schema', () => {
  it('creates the domain tables', async () => {
    const names = await withClient(async (c) => {
      const { rows } = await c.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname='public'`,
      );
      return rows.map((r) => r.tablename);
    });
    expect(names).toEqual(
      expect.arrayContaining([
        'import_jobs',
        'ingredients',
        'recipe_steps',
        'recipes',
        'cookbooks',
        'cookbook_recipes',
        'users',
      ]),
    );
    // C6: saved_recipes is dropped; C5a: the food catalog is in-memory, not a table.
    expect(names).not.toContain('saved_recipes');
    expect(names).not.toContain('foods');
    expect(names).not.toContain('food_portions');
  });

  it('has the phone unique index, the recipe owner index, and enums', async () => {
    await withClient(async (c) => {
      const idx = await c.query(
        `select indexname from pg_indexes where schemaname='public'
         and indexname in ('users_phone_uidx','recipes_user_idx','import_jobs_user_idx')`,
      );
      expect(idx.rowCount).toBe(3);

      // C6: recipes carry an owner column; C5a: no pg_trgm extension.
      const owner = await c.query(
        `select 1 from information_schema.columns where table_name='recipes' and column_name='user_id'`,
      );
      expect(owner.rowCount).toBe(1);
      const trgm = await c.query(`select 1 from pg_extension where extname='pg_trgm'`);
      expect(trgm.rowCount).toBe(0);

      // C2 onboarding + C5 nutrition enum types exist; the old jsonb column is gone.
      const enums = await c.query<{ typname: string }>(
        `select typname from pg_type where typname in
           ('source_type','import_job_status','goal','age_band','nutrition_source')`,
      );
      expect(enums.rows.map((r) => r.typname).sort()).toEqual(
        ['age_band', 'goal', 'import_job_status', 'nutrition_source', 'source_type'],
      );
      const onboarding = await c.query(
        `select 1 from information_schema.columns where table_name='users' and column_name='onboarding'`,
      );
      expect(onboarding.rowCount).toBe(0);
    });
  });

  it('cascades recipe deletes to ingredients and recipe_steps', async () => {
    const rows = await withClient(async (c) => {
      const { rows } = await c.query<{ confdeltype: string }>(
        `select confdeltype from pg_constraint where contype='f' and conname in
           ('ingredients_recipe_id_recipes_id_fk','recipe_steps_recipe_id_recipes_id_fk')`,
      );
      return rows;
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.confdeltype).toBe('c');
  });
});

describe('health', () => {
  it('GET /healthz returns 200 when the DB is reachable', async () => {
    const app = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
    } finally {
      await app.close();
    }
  });
});
