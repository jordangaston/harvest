import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { randomUUID } from 'node:crypto';
import { getHarness, teardownHarness } from '../helpers/dbos-harness.js';
import { buildApp } from '../../src/api/app.js';
import { createDb } from '../../src/db/index.js';
import { pingWorkflow } from '../../src/pipeline/bootstrap.js';
import type { Container } from '../../src/container.js';
import { TEST_DATABASE_URL, TEST_DBOS_SYSTEM_URL } from '../helpers/integration-env.js';

let container: Container;

beforeAll(async () => {
  container = await getHarness();
});

afterAll(async () => {
  await teardownHarness();
});

describe('TC-1: migrations create the exact schema', () => {
  it('creates all five tables', async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname='public' order by tablename`,
      );
      const names = rows.map((r) => r.tablename);
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
    } finally {
      await client.end();
    }
  });

  it('enforces unique users.phone and the two enums', async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const idx = await client.query(
        `select indexname from pg_indexes where schemaname='public'
         and indexname in ('users_phone_uidx','saved_recipes_user_idx','import_jobs_user_idx')`,
      );
      expect(idx.rowCount).toBe(3);

      const enums = await client.query<{ typname: string }>(
        `select typname from pg_type where typname in ('source_type','import_job_status')`,
      );
      expect(enums.rows.map((r) => r.typname).sort()).toEqual([
        'import_job_status',
        'source_type',
      ]);
    } finally {
      await client.end();
    }
  });

  it('cascades deletes from recipes to ingredients and recipe_steps', async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ conname: string; confdeltype: string }>(
        `select conname, confdeltype from pg_constraint
         where contype='f' and conname in
           ('ingredients_recipe_id_recipes_id_fk','recipe_steps_recipe_id_recipes_id_fk')`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.confdeltype).toBe('c');
    } finally {
      await client.end();
    }
  });
});

describe('TC-2: boot + health', () => {
  it('reports 200 with db + dbos ok when booted', async () => {
    const app = buildApp(container);
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', db: 'ok', dbos: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('creates the DBOS system schema on the same server (harvest_dbos)', async () => {
    const client = new Client({ connectionString: TEST_DBOS_SYSTEM_URL });
    await client.connect();
    try {
      const { rowCount } = await client.query(
        `select 1 from pg_tables where schemaname='dbos'`,
      );
      expect(rowCount).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  });
});

describe('TC-3: DBOS workflow + transactional write round-trip', () => {
  it('runs the step, persists the transactional insert, and resumes without duplicating', async () => {
    const workflowID = `it-${randomUUID()}`;

    const handle = await DBOS.startWorkflow(pingWorkflow, { workflowID })();
    const result = await handle.getResult();
    expect(result.step).toBe('pong');
    expect(result.insertedId).toMatch(/^[0-9a-f-]{36}$/);

    // the inserted row is readable
    const [row] = await container.db.execute(
      sql`select id from users where id = ${result.insertedId}`,
    ).then((r) => (r as { rows: { id: string }[] }).rows);
    expect(row.id).toBe(result.insertedId);

    // re-running the same workflow id resumes from checkpoint (no new insert)
    const handle2 = await DBOS.startWorkflow(pingWorkflow, { workflowID })();
    const result2 = await handle2.getResult();
    expect(result2.insertedId).toBe(result.insertedId);
  });
});

describe('TC-4: health degrades when the DB is down', () => {
  it('returns 503 with db:error without crashing', async () => {
    const badDb = createDb('postgresql://postgres:postgres@localhost:5432/harvest_nonexistent_db');
    const app = buildApp(
      { db: badDb.db, pool: badDb.pool, close: badDb.close },
      { checkDbos: () => true },
    );
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'error', db: 'error' });
    } finally {
      await app.close();
      await badDb.close();
    }
  });
});
