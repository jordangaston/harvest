import 'dotenv/config'; // load .env (OPENAI_API_KEY etc.) for the enrichers; inline vars still win
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { and, eq, isNull } from 'drizzle-orm';
import { makeDb, type Database } from '../src/db.js';
import { recipes } from '../src/schema.js';
import { classifySource } from '../src/classify.js';
import { fetchSource } from '../src/providers.js';
import { toExtractedData, hasRecipe, toRecipeInput } from '../src/parse/mapping.js';
import type { ExtractedRecipeData } from '../src/parse/extractor.js';
import type { ImportInput } from '../src/import-domain.js';
import { RecipeRepository } from '../src/repositories/recipe-repository.js';
import { NutritionEstimator } from '../src/nutrition/nutrition-estimator.js';
import { CostEstimator } from '../src/price/cost-estimator.js';
import { AllergenDetector } from '../src/allergen/allergen-detector.js';
import { RecipeCategorizer } from '../src/categorize/recipe-categorizer.js';
import { EquipmentDetector } from '../src/equipment/equipment-detector.js';
import { DietClassifier } from '../src/diet/diet-classifier.js';

/**
 * Seeds GLOBAL recipes (`user_id IS NULL`) by driving the real ingest pipeline over a list
 * of recipe-source URLs: fetch → extract (JSON-LD) → the same enrichers a user import runs
 * (nutrition/NRF, cost, allergens, categories/meal-prep, equipment, diet) → persist with a
 * null owner. Nothing is authored; every field is derived from the specified sources.
 *
 * Idempotent (skips a URL already persisted as a global) so it is resumable — kill and re-run.
 * `TURSO_DATABASE_URL` must point at a DB that already has the reference tables seeded
 * (`npm run seed:reference`). Reads URLs from `--urls <file>` (JSON array of strings or
 * `{url}` objects); `LIMIT`/`CONCURRENCY` env tune a trial run.
 */

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;

// Obvious non-recipe pages — dropped up front to save fetches. Anything that slips through
// (roundups, blog posts) has no Recipe JSON-LD, so `hasRecipe` drops it after the fetch.
const SKIP = [
  /\/category\//, /\/web-stories\//, /\/shop\//, /\/lifestyle\//, /\/press\//, /\/barn\//,
  /\/cookbook/, /\/(meet-tieghan|pantry|kitchen|kitchenitems|videos|community|contact|register|log-in|subscribe|essentials|holiday|book-tour|targetcart|cookiebox|thanksgiving-shop|weekly-meal-plan|recipe-index|recipe-archives|recipe-collections|recipes|accessibility-statement|privacy-policy|community-test)$/,
  /\/(nine-favorite-things|hbh-meal-plan|things-i-am-going-crazy|chaos-n-sprinkles|links-love|links-inspire|things-loving-lately|nine-of-my-favorite)/,
  /how-to-|-gift-guide|gift-guides|-cookie-box|-round-up|-menu-and-guide|most-popular|recipes-to-cook|favorite-healthy-recipes|-recipes$|favorite-things|reader-survey/,
];

const shouldSkip = (url: string) => SKIP.some((re) => re.test(url));

function loadUrls(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as (string | { url: string })[];
  const urls = raw.map((r) => (typeof r === 'string' ? r : r.url)).filter(Boolean);
  return Array.from(new Set(urls)); // de-dupe (the list has a few repeats)
}

/** Run the same enrichers the import workflow runs, attaching each result the way its
 * step does, so `toRecipeInput` reads them identically. Each is best-effort (a failure
 * leaves that signal null), matching the workflow's per-recipe try/catch. */
async function enrich(e: Enrichers, data: ExtractedRecipeData): Promise<ExtractedRecipeData> {
  const parsed = data.servings ? parseInt(data.servings, 10) : NaN;
  const servings = Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
  let d = data;
  try { d = { ...d, estimate: await e.nutrition.run(d.ingredients, servings, d.nutrition) }; } catch {}
  try { const c = await e.cost.estimate(d.ingredients, servings); if (c) d = { ...d, cost: c }; } catch {}
  try { const a = await e.allergen.detect(d.ingredients); if (a) d = { ...d, allergens: a }; } catch {}
  try {
    const { categories, stepTechniques, mealPrepFit } = await e.categorizer.analyze(d.title, d.ingredients, d.steps, servings);
    d = { ...d, categories, stepTechniques: stepTechniques.length ? stepTechniques : undefined, mealPrepFit };
  } catch {}
  try { d = { ...d, equipment: await e.equipment.detect(d.title, d.ingredients.map((i) => i.name), d.steps) }; } catch {}
  try { const diets = await e.diet.classify(d.ingredients, servings, d.nutrition); if (diets) d = { ...d, diets }; } catch {}
  return d;
}

interface Enrichers {
  nutrition: NutritionEstimator; cost: CostEstimator; allergen: AllergenDetector;
  categorizer: RecipeCategorizer; equipment: EquipmentDetector; diet: DietClassifier;
}

async function alreadySeeded(db: Database, url: string): Promise<boolean> {
  const [row] = await db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.sourceUrl, url), isNull(recipes.userId)));
  return Boolean(row);
}

const stats = { seeded: 0, existing: 0, notRecipe: 0, failed: 0 };

async function seedOne(db: Database, repo: RecipeRepository, e: Enrichers, url: string): Promise<void> {
  const classified = classifySource({ url });
  if (!classified) { stats.notRecipe++; return; }
  const input: ImportInput = { jobId: 'seed', userId: 'seed', sourceType: classified.sourceType, sourceRef: classified.ref };
  try {
    if (await alreadySeeded(db, classified.ref)) { stats.existing++; return; }
    const material = await fetchSource(input);
    if (!material.structured) { stats.notRecipe++; return; }
    let data = toExtractedData(material.structured, 1);
    if (material.thumbnailUrl) data = { ...data, imageUrl: data.imageUrl || material.thumbnailUrl };
    if (!hasRecipe(data)) { stats.notRecipe++; return; }
    const recipeId = await repo.persist(toRecipeInput(await enrich(e, data), input), null);
    stats.seeded++;
    console.log(`✓ ${data.title}  (${classified.ref})  id=${recipeId}`);
  } catch (err) {
    stats.failed++;
    console.log(`✗ ${classified.ref}  ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) await fn(items[idx++]);
  }));
}

async function main(): Promise<void> {
  const urlsArg = process.argv.indexOf('--urls');
  const path = urlsArg >= 0 ? process.argv[urlsArg + 1] : process.env.URLS;
  const url = process.env.TURSO_DATABASE_URL;
  if (!path || !url) {
    console.error('Usage: TURSO_DATABASE_URL=… tsx scripts/seed-recipes.ts --urls <file.json>');
    process.exit(1);
  }
  const db = makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  const repo = RecipeRepository.create(db);
  const e: Enrichers = {
    nutrition: NutritionEstimator.create(db), cost: CostEstimator.create(db), allergen: AllergenDetector.create(db),
    categorizer: RecipeCategorizer.create(db), equipment: EquipmentDetector.create(), diet: DietClassifier.create(db),
  };

  const all = loadUrls(path);
  const candidates = all.filter((u) => !shouldSkip(u)).slice(0, LIMIT);
  console.log(`${all.length} urls → ${candidates.length} recipe candidates (concurrency ${CONCURRENCY})\n`);

  await pool(candidates, CONCURRENCY, (u) => seedOne(db, repo, e, u));
  console.log(`\nDone. seeded=${stats.seeded} existing=${stats.existing} not-recipe=${stats.notRecipe} failed=${stats.failed}`);
}

await main();
