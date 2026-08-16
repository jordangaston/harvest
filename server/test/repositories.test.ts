import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { makeDb, type Database } from '../src/db.js';
import { recipes, ingredients, recipeSteps, importJobRecipes } from '../src/schema.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { ImportJobRepository } from '../src/repositories/import-job-repository.js';
import { RecipeRepository, type RecipeInput } from '../src/repositories/recipe-repository.js';
import { CookbookRepository } from '../src/repositories/cookbook-repository.js';
import { CookbookExistsError } from '../src/errors.js';

/**
 * Fast offline data-layer tests — @libsql/client with a local `file:` database
 * (the same client build that opens a Turso cloud URL), migrated from the
 * generated DDL. A file (not `:memory:`, which is connection-private) is required
 * so an interactive transaction's connection shares the schema.
 */
let db: Database;
let dir: string;

const newRecipe = (over: Partial<RecipeInput> = {}): RecipeInput => ({
  title: 'Creamy Garlic Chicken',
  sourceType: 'website',
  sourceUrl: 'https://x.test/r',
  servings: 4,
  servingsEstimated: false,
  totalMinutes: 30,
  nutrition: null,
  ingredients: [
    { name: 'chicken', amount: '2', unit: null, quantityText: '2 breasts' },
    { name: 'garlic', amount: '4', unit: 'cloves', quantityText: '4 cloves' },
  ],
  steps: ['Sear the chicken.', 'Simmer the sauce.'],
  ...over,
});

const makeUser = (phone = '+15555550100') =>
  UserRepository.create(db).insert({ phone, jwtPrivateKey: 'k', jwtPublicKey: 'p' });

beforeEach(async () => {
  const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
  const sqlFile = readdirSync(drizzleDir).find((f) => f.endsWith('.sql'));
  if (!sqlFile) throw new Error('run `npm run db:generate` first — no drizzle/*.sql found');
  dir = mkdtempSync(join(tmpdir(), 'harvest-libsql-'));
  const client = createClient({ url: `file:${join(dir, 't.db')}` });
  await client.executeMultiple(readFileSync(join(drizzleDir, sqlFile), 'utf8'));
  db = makeDb(client);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('UserRepository', () => {
  it('inserts, reads by id/phone, round-trips onboarding JSON arrays, and bumps nonces', async () => {
    const repo = UserRepository.create(db);
    const created = await repo.insert({
      phone: '+15555550100',
      jwtPrivateKey: 'k',
      jwtPublicKey: 'p',
      goals: ['eat_healthier', 'save_money'],
      cookDays: ['mon', 'wed'],
      whenCook: 'evening_ready',
      age: 'from_25_to_34',
    });
    // JSON-mode arrays and single-select enums round-trip through the DB.
    expect(created.goals).toEqual(['eat_healthier', 'save_money']);
    expect(created.cookDays).toEqual(['mon', 'wed']);
    expect(created.whenCook).toBe('evening_ready');
    expect(created.recipeSources).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);

    expect((await repo.findById(created.id))?.id).toBe(created.id);
    expect((await repo.findByPhone('+15555550100'))?.id).toBe(created.id);
    expect(await repo.findById(crypto.randomUUID())).toBeNull();

    await repo.bumpNonce(created.id, 'access');
    await repo.bumpNonce(created.id, 'refresh');
    const bumped = await repo.findById(created.id);
    expect(bumped?.accessTokenNonce).toBe(1);
    expect(bumped?.refreshTokenNonce).toBe(1);
  });
});

describe('RecipeRepository', () => {
  it('persist commits recipe + ingredients + steps in one transaction; findById returns the ordered aggregate', async () => {
    const user = await makeUser();
    const recipeRepo = RecipeRepository.create(db);
    const recipeId = await recipeRepo.persist(newRecipe(), user.id);

    const detail = await recipeRepo.findById(recipeId);
    expect(detail?.recipe.title).toBe('Creamy Garlic Chicken');
    expect(detail?.ingredients.map((i) => i.name)).toEqual(['chicken', 'garlic']);
    expect(detail?.ingredients[1].icon).toBe('garlic'); // icon resolved at the persist choke point
    expect(detail?.steps).toEqual(['Sear the chicken.', 'Simmer the sauce.']);
    expect(await recipeRepo.exists(recipeId)).toBe(true);
    expect(await recipeRepo.findOwner(recipeId)).toBe(user.id);
  });

  it('persist rolls ALL of it back on a mid-transaction throw (atomicity)', async () => {
    const user = await makeUser();
    const recipeRepo = RecipeRepository.create(db);
    // Force a failure after the recipe+ingredients writes: a step row with a
    // non-string text violates NOT NULL, throwing inside the transaction.
    const bad = newRecipe({ steps: [null as unknown as string] });
    await expect(recipeRepo.persist(bad, user.id)).rejects.toThrow();

    // Nothing from the failed persist survives.
    expect((await db.select().from(recipes)).length).toBe(0);
    expect((await db.select().from(ingredients)).length).toBe(0);
    expect((await db.select().from(recipeSteps)).length).toBe(0);
  });

  it('updateContent replaces ingredients and steps in one transaction', async () => {
    const user = await makeUser();
    const recipeRepo = RecipeRepository.create(db);
    const recipeId = await recipeRepo.persist(newRecipe(), user.id);

    await recipeRepo.updateContent(recipeId, {
      ingredients: [{ name: 'basil', amount: null, unit: null, quantityText: 'a handful' }],
      steps: ['Chop.', 'Serve.'],
    });
    const detail = await recipeRepo.findById(recipeId);
    expect(detail?.ingredients.map((i) => i.name)).toEqual(['basil']);
    expect(detail?.steps).toEqual(['Chop.', 'Serve.']);
  });

  it('deleteOwned removes the recipe and cascades to its children; a non-owner cannot delete', async () => {
    const owner = await makeUser('+15555550100');
    const stranger = await makeUser('+15555550111');
    const recipeRepo = RecipeRepository.create(db);
    const recipeId = await recipeRepo.persist(newRecipe(), owner.id);

    expect(await recipeRepo.deleteOwned(stranger.id, recipeId)).toBe(false);
    expect(await recipeRepo.exists(recipeId)).toBe(true);

    expect(await recipeRepo.deleteOwned(owner.id, recipeId)).toBe(true);
    expect(await recipeRepo.exists(recipeId)).toBe(false);
    // Cascade: children fall away (FK enforcement is on by default in libSQL).
    expect((await db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId))).length).toBe(0);
    expect((await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).length).toBe(0);
  });

  it('listOwned returns only the caller\'s recipes, newest first', async () => {
    const a = await makeUser('+15555550100');
    const b = await makeUser('+15555550111');
    const recipeRepo = RecipeRepository.create(db);
    await recipeRepo.persist(newRecipe({ title: 'A1' }), a.id);
    await recipeRepo.persist(newRecipe({ title: 'B1' }), b.id);
    const owned = await recipeRepo.listOwned(a.id);
    expect(owned.map((r) => r.title)).toEqual(['A1']);
  });
});

describe('ImportJobRepository', () => {
  it('creates a queued job, transitions running→terminal, links recipes, and hides foreign jobs', async () => {
    const owner = await makeUser('+15555550100');
    const stranger = await makeUser('+15555550111');
    const jobRepo = ImportJobRepository.create(db);
    const recipeRepo = RecipeRepository.create(db);
    const recipeId = await recipeRepo.persist(newRecipe(), owner.id);

    const jobId = crypto.randomUUID();
    const job = await jobRepo.create({ id: jobId, userId: owner.id, sourceType: 'website', sourceRef: 'https://x.test/r' });
    expect(job.status).toBe('queued');
    expect(job.updatedAt).toBeInstanceOf(Date);

    await jobRepo.setRunning(jobId, 10);
    expect((await jobRepo.findByIdForUser(jobId, owner.id))?.status).toBe('running');

    await jobRepo.linkRecipes(jobId, [recipeId]);
    await jobRepo.linkRecipes(jobId, [recipeId]); // idempotent re-link
    expect(await jobRepo.findRecipeIds(jobId)).toEqual([recipeId]);

    await jobRepo.setTerminal(jobId, { status: 'ready', progress: 100, recipeId });
    const ready = await jobRepo.findByIdForUser(jobId, owner.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.recipeId).toBe(recipeId);

    // Owner-scoped read hides a foreign job.
    expect(await jobRepo.findByIdForUser(jobId, stranger.id)).toBeNull();
  });
});

describe('CookbookRepository', () => {
  it('creates a cookbook; a duplicate (userId, name) throws CookbookExistsError (delta a)', async () => {
    const user = await makeUser();
    const repo = CookbookRepository.create(db);
    await repo.create(user.id, 'Dinner');
    await expect(repo.create(user.id, 'Dinner')).rejects.toBeInstanceOf(CookbookExistsError);
    // Same name is fine for a different owner (the unique index is per-user).
    const other = await makeUser('+15555550111');
    await expect(repo.create(other.id, 'Dinner')).resolves.toBeTruthy();
  });

  it('listForUser computes recipe count and cover; getForUser is owner-scoped', async () => {
    const owner = await makeUser('+15555550100');
    const stranger = await makeUser('+15555550111');
    const recipeRepo = RecipeRepository.create(db);
    const repo = CookbookRepository.create(db);
    const cb = await repo.create(owner.id, 'Dinner');
    const r1 = await recipeRepo.persist(newRecipe({ title: 'R1', imageUrl: 'https://img/1' }), owner.id);
    const r2 = await recipeRepo.persist(newRecipe({ title: 'R2', imageUrl: 'https://img/2' }), owner.id);
    await repo.setMembership(owner.id, r1, [cb.id]);
    await repo.setMembership(owner.id, r2, [cb.id]);

    const [summary] = await repo.listForUser(owner.id);
    expect(summary.recipeCount).toBe(2);
    expect(summary.coverImageUrl).toBeTruthy();

    expect((await repo.getForUser(owner.id, cb.id))?.recipes.length).toBe(2);
    expect(await repo.getForUser(stranger.id, cb.id)).toBeNull(); // foreign cookbook hidden
  });

  it('setMembership makes membership exactly the owned subset (foreign cookbook ids ignored)', async () => {
    const owner = await makeUser('+15555550100');
    const stranger = await makeUser('+15555550111');
    const recipeRepo = RecipeRepository.create(db);
    const repo = CookbookRepository.create(db);
    const mine1 = await repo.create(owner.id, 'Weeknight');
    const mine2 = await repo.create(owner.id, 'Weekend');
    const theirs = await repo.create(stranger.id, 'Foreign');
    const recipeId = await recipeRepo.persist(newRecipe(), owner.id);

    // File into mine1 + a foreign cookbook: only mine1 sticks.
    const applied = await repo.setMembership(owner.id, recipeId, [mine1.id, theirs.id]);
    expect(applied).toEqual([mine1.id]);

    // Re-file into mine2 only: membership becomes exactly {mine2} — mine1 dropped.
    await repo.setMembership(owner.id, recipeId, [mine2.id]);
    const mine1Recipes = (await repo.getForUser(owner.id, mine1.id))?.recipes ?? [];
    const mine2Recipes = (await repo.getForUser(owner.id, mine2.id))?.recipes ?? [];
    expect(mine1Recipes.length).toBe(0);
    expect(mine2Recipes.length).toBe(1);
  });
});
