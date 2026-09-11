import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { TasteRepository } from '../src/ranking/taste/taste-repository.js';
import { measureIngredientDensity, measurePairDensity } from '../src/corpus/density.js';

/**
 * Corpus density audit (`corpus:density`, read-only): reports whether the corpus is dense enough for
 * the embedding model's PMI to converge — the rule "the 200th-most-common base ingredient still
 * appears in ≥30 recipes" — plus the per-pair co-occurrence tail. Run before sourcing to size the
 * gap. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const profiles = await TasteRepository.create(makeDb(client)).allProfiles();
const dfRows = (await client.execute('SELECT document_frequency FROM ingredient_distinctiveness')).rows as unknown as { document_frequency: number }[];
const dfs = dfRows.map((r) => Number(r.document_frequency));

const ing = measureIngredientDensity(dfs, profiles.size);
const pair = measurePairDensity([...profiles.values()].map((p) => Object.keys(p)));

console.log(`corpus density — ${ing.nRecipes} recipes, ${ing.nIngredients} base ingredients\n`);
console.log(`per-ingredient rule: the ${ing.rank}th-most-common appears in ${ing.rankDf} recipes (need ≥${ing.dfRule}) → ${ing.rulePasses ? 'PASS' : 'FAIL'}`);
console.log(`  ${ing.ingredientsMeetingRule}/${ing.nIngredients} ingredients clear df≥${ing.dfRule}`);
console.log('  df distribution:');
for (const h of ing.histogram) console.log(`    ${h.bucket.padEnd(8)} ${h.count}`);
console.log(`\nper-pair co-occurrence: ${pair.coOccurringPairs} distinct pairs`);
for (const t of pair.pairsAtLeast) console.log(`  pairs in ≥${t.threshold} recipes: ${t.count}`);
process.exit(0);
