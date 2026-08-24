import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { ingredientDistinctiveness, recipeTasteProfiles } from '../src/schema.js';
import { RecipeTasteProfiler } from '../src/ranking/taste/recipe-taste-profiler.js';

/**
 * Affinity v2 offline build (RecipeTasteProfiler): turns the corpus into taste profiles.
 * 1. Roll each recipe up to its set of base ingredients (ingredients → fdc_foods.base_ingredient_id).
 * 2. document_frequency + idf = ln(N / (1 + df)) per base ingredient (clamped ≥ 0 — ubiquitous
 *    staples like salt collapse to ~0 and drop out).
 * 3. Each recipe's profile = the sparse map base_ingredient_id → idf, L2-normalized.
 * Persists `ingredient_distinctiveness` and `recipe_taste_profiles`. Idempotent (truncate + rebuild).
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const pairs = await client.execute(
  'select distinct i.recipe_id as rid, f.base_ingredient_id as bid ' +
    'from ingredients i join fdc_foods f on f.fdc_id = i.fdc_id ' +
    'where f.base_ingredient_id is not null',
);

const byRecipe = new Map<string, string[]>();
for (const r of pairs.rows) {
  const rid = String(r.rid);
  const list = byRecipe.get(rid);
  if (list) list.push(String(r.bid));
  else byRecipe.set(rid, [String(r.bid)]);
}

const { distinctiveness: distRows, profiles } = new RecipeTasteProfiler().build(byRecipe);
const empty = byRecipe.size - profiles.size;
console.log(`${byRecipe.size} recipes with ≥1 base ingredient · ${distRows.length} distinct base ingredients`);

const now = Date.now();
const profileRows = [...profiles].map(([recipeId, weights]) => ({ recipeId, weights, builtAt: now }));

const chunk = <T>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

await db.delete(recipeTasteProfiles);
await db.delete(ingredientDistinctiveness);
for (const c of chunk(distRows, 300)) await db.insert(ingredientDistinctiveness).values(c);
for (const c of chunk(profileRows, 300)) await db.insert(recipeTasteProfiles).values(c);

console.log(`Done. profiles=${profileRows.length} (empty/all-ubiquitous skipped=${empty}) · distinctiveness=${distRows.length}`);
process.exit(0);
