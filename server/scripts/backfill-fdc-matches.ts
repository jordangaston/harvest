import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { FdcFoodRepository } from '../src/nutrition/fdc-food-repository.js';
import { FoodMatcher } from '../src/nutrition/food-matcher.js';

/**
 * Affinity v2 data backfill: stamps `ingredients.fdc_id` / `match_quality` on recipes that
 * were seeded before the taste-overhaul persisted matches. Reuses the ingest FoodMatcher
 * (offline trigram FTS5, no network/LLM). Dedupes by distinct ingredient name — the match is
 * a pure function of the name — so it runs in one pass over the vocabulary, not every row.
 * Idempotent: re-running re-matches and overwrites. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);
const matcher = FoodMatcher.create(FdcFoodRepository.create(db));

const names = await client.execute(
  "select distinct name from ingredients where name is not null and name <> ''",
);
console.log(`${names.rows.length} distinct ingredient names`);

let matched = 0;
for (let i = 0; i < names.rows.length; i++) {
  const name = String(names.rows[i]!.name);
  const m = await matcher.match(name);
  // Set on a match; CLEAR on a non-match so a stricter matcher removes stale matches (not just adds).
  await client.execute({
    sql: 'update ingredients set fdc_id = ?, match_quality = ? where name = ?',
    args: [m?.fdcId ?? null, m?.quality ?? null, name],
  });
  if (m) matched++;
  if ((i + 1) % 2000 === 0) console.log(`  ${i + 1}/${names.rows.length} names · ${matched} matched`);
}

const cov = await client.execute(
  'select ' +
    "round(100.0*sum(case when fdc_id is not null then 1 else 0 end)/count(*),1) as fdc_pct, " +
    'count(*) as total from ingredients',
);
const base = await client.execute(
  'select count(*) as with_base from ingredients i ' +
    'join fdc_foods f on f.fdc_id = i.fdc_id where f.base_ingredient_id is not null',
);
console.log(`\nDone. matched names=${matched}`);
console.log('ingredient rows fdc coverage:', cov.rows[0]);
console.log('ingredient rows rolling up to a base ingredient (vector dims):', base.rows[0]);
process.exit(0);
