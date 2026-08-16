// S1 demo — the atomicity proof, fully offline against a `file:` libSQL database.
//
// Migrates a fresh db from the generated DDL, then exercises the REAL
// RecipeRepository.persist interactive transaction two ways:
//   1. a successful persist  → recipe + ingredients + steps + job link + status all land
//   2. a deliberately faulted persist (a mid-transaction throw) → NOTHING lands
// and prints row counts before/after each, proving both commit-together and
// rollback-together.
//
// Run: `npm run demo`  (tsx, so it imports the TS repositories directly).
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { makeDb } from '../src/db.js';
import { users, recipes, ingredients, recipeSteps, importJobs, importJobRecipes } from '../src/schema.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { ImportJobRepository } from '../src/repositories/import-job-repository.js';
import { RecipeRepository } from '../src/repositories/recipe-repository.js';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');
const sqlFile = readdirSync(drizzleDir).find((f) => f.endsWith('.sql'));
const dir = mkdtempSync(join(tmpdir(), 'harvest-demo-'));
const client = createClient({ url: `file:${join(dir, 'demo.db')}` });
await client.executeMultiple(readFileSync(join(drizzleDir, sqlFile), 'utf8'));
const db = makeDb(client);

const userRepo = UserRepository.create(db);
const jobRepo = ImportJobRepository.create(db);
const recipeRepo = RecipeRepository.create(db);

const count = async (table) => (await db.select().from(table)).length;
const counts = async () => ({
  recipes: await count(recipes),
  ingredients: await count(ingredients),
  steps: await count(recipeSteps),
  links: await count(importJobRecipes),
});

const sampleRecipe = () => ({
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
});

const user = await userRepo.insert({ phone: '+15555550100', jwtPrivateKey: 'k', jwtPublicKey: 'p' });

// ── 1. Successful persist ───────────────────────────────────────────────────
console.log('before persist      :', JSON.stringify(await counts()));
const recipeId = await recipeRepo.persist(sampleRecipe(), user.id);
const jobId = crypto.randomUUID();
await jobRepo.create({ id: jobId, userId: user.id, sourceType: 'website', sourceRef: 'https://x.test/r' });
await jobRepo.linkRecipes(jobId, [recipeId]);
await jobRepo.setTerminal(jobId, { status: 'ready', progress: 100, recipeId });
console.log('after  persist+link :', JSON.stringify(await counts()), '← recipe, 2 ingredients, 2 steps, 1 link all landed');

// ── 2. Deliberately rolled-back transaction ─────────────────────────────────
const before = await counts();
let rolledBack = false;
try {
  await db.transaction(async (tx) => {
    await tx.insert(recipes).values({ userId: user.id, title: 'Doomed', sourceType: 'website', servings: 1, servingsEstimated: false });
    // Throw mid-transaction, AFTER a write — libSQL must roll the write back.
    throw new Error('injected fault');
  });
} catch (e) {
  rolledBack = e.message === 'injected fault';
}
const after = await counts();
console.log('before rollback     :', JSON.stringify(before));
console.log('after  rollback     :', JSON.stringify(after), rolledBack ? '← unchanged: the faulted write rolled back' : '');

const atomic = after.recipes === before.recipes && after.ingredients === before.ingredients;
console.log(`\nATOMICITY PROVEN: ${atomic && rolledBack ? 'YES' : 'NO'} — commit-together on success, rollback-together on fault.`);

rmSync(dir, { recursive: true, force: true });
process.exit(atomic && rolledBack ? 0 : 1);
