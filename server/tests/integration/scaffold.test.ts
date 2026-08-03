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
        'saved_recipes',
        'users',
      ]),
    );
  });

  it('has the phone unique index, cookbook index, and enums', async () => {
    await withClient(async (c) => {
      const idx = await c.query(
        `select indexname from pg_indexes where schemaname='public'
         and indexname in ('users_phone_uidx','saved_recipes_user_idx','import_jobs_user_idx')`,
      );
      expect(idx.rowCount).toBe(3);

      const enums = await c.query<{ typname: string }>(
        `select typname from pg_type where typname in ('source_type','import_job_status')`,
      );
      expect(enums.rows.map((r) => r.typname).sort()).toEqual(['import_job_status', 'source_type']);
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
