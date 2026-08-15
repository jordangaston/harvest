import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { ImportStore, makeDb } from '../src/db.js';
import { importJobRecipes, ingredients, recipeSteps } from '../src/schema.js';
import type { RecipeRow } from '../src/mapping.js';
import type { ImportInput } from '../src/domain.js';

/**
 * Tier-1 integration test — the libSQL data layer, fully offline. Uses
 * `@libsql/client` with a local `file:` database (the same client build that opens
 * a Turso cloud URL), so `npm test` needs no server and no account. A file (not
 * `:memory:`, which is connection-private) is required so the interactive
 * transaction's connection shares the schema. It proves the restored
 * `db.transaction()` persist commits the recipe, its children, the job link, and
 * the terminal status atomically — the transaction D1 could not give us.
 */
describe('libSQL data layer (offline, interactive transaction)', () => {
  let store: ImportStore;
  let db: ReturnType<typeof makeDb>;
  let dir: string;

  beforeEach(async () => {
    // Resolve drizzle/ relative to this file so the test is cwd-independent.
    const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
    const sqlFile = readdirSync(drizzleDir).find((f) => f.endsWith('.sql'));
    if (!sqlFile) throw new Error('run `npm run db:generate` first — no drizzle/*.sql found');
    dir = mkdtempSync(join(tmpdir(), 'harvest-libsql-'));
    const client = createClient({ url: `file:${join(dir, 't.db')}` });
    await client.executeMultiple(readFileSync(join(drizzleDir, sqlFile), 'utf8'));
    db = makeDb(client);
    store = new ImportStore(db);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persistAndReady writes recipe + children + link + status in one transaction', async () => {
    const userId = await store.createUser('+15555550100');
    const jobId = crypto.randomUUID();
    await store.createJob({ id: jobId, userId, sourceType: 'website', sourceRef: 'https://x.test/r' });

    const input: ImportInput = { jobId, userId, sourceType: 'website', sourceRef: 'https://x.test/r' };
    const row: RecipeRow = {
      title: 'Creamy Garlic Chicken',
      sourceType: 'website',
      sourceUrl: 'https://x.test/r',
      servings: 4,
      servingsEstimated: false,
      totalMinutes: 30,
      imageUrl: null,
      confidence: '0.9',
      ingredients: [
        { name: 'chicken', amount: '2', unit: null, quantityText: '2 breasts' },
        { name: 'garlic', amount: '4', unit: 'cloves', quantityText: '4 cloves' },
      ],
      steps: ['Sear the chicken.', 'Simmer the sauce.'],
    };

    const recipeId = await store.persistAndReady(row, input);

    // Every write in the transaction landed together.
    const job = await store.getJob(jobId);
    expect(job?.status).toBe('ready');
    expect(job?.recipeId).toBe(recipeId);
    expect((await db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId))).length).toBe(2);
    expect((await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).length).toBe(2);
    expect((await db.select().from(importJobRecipes).where(eq(importJobRecipes.importJobId, jobId))).length).toBe(1);
  });

  it('bumpFaultAttempts increments and returns the new count (RETURNING works on libSQL)', async () => {
    const userId = await store.createUser('+15555550111');
    const jobId = crypto.randomUUID();
    await store.createJob({ id: jobId, userId, sourceType: 'website', sourceRef: 'https://x.test/r' });
    expect(await store.bumpFaultAttempts(jobId)).toBe(1);
    expect(await store.bumpFaultAttempts(jobId)).toBe(2);
  });
});
