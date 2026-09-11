import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { TasteRepository } from '../src/ranking/taste/taste-repository.js';
import { TasteSpace } from '../src/ranking/taste/taste-space.js';
import { idfRecommender, randomRecommender, popularityRecommender } from '../src/eval/recsys/recommenders.js';
import { evaluate, formatReport } from '../src/eval/recsys/harness.js';
import type { GoldSet } from '../src/eval/recsys/types.js';

/**
 * recsys eval runner (`eval:recsys`): score every registered recipe-similarity model against the
 * checked-in gold set (`eval/gold/*.json`) and print the headline MRR + per-cuisine diagnostics.
 * The IDF model is today's taste-profile cosine; `random`/`popularity` are the floor. `popularity`
 * is unavailable until the signal ships (`recipes.popularity` doesn't exist). Target DB from
 * `TURSO_DATABASE_URL`. The gold content itself is produced by the Tier specs.
 */
const GOLD_DIR = join(process.cwd(), 'eval', 'gold');

function loadGold(): GoldSet {
  let files: string[] = [];
  try {
    files = readdirSync(GOLD_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return { queries: [] };
  }
  const queries = files.flatMap((f) => (JSON.parse(readFileSync(join(GOLD_DIR, f), 'utf8')) as GoldSet).queries ?? []);
  return { queries };
}

const gold = loadGold();
if (gold.queries.length === 0) {
  console.log(`No gold queries in ${GOLD_DIR}. Generate a test set (Tier 1) first — see eval/gold/README.md.`);
  process.exit(0);
}

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const space = new TasteSpace(await TasteRepository.create(makeDb(client)).allProfiles());

const idf = idfRecommender(space);
const random = randomRecommender();
const popularity = popularityRecommender(new Map()); // empty until recipes.popularity ships

const reports = [
  evaluate(idf, gold),
  evaluate(random, gold),
  evaluate(popularity, gold, popularity.available ? undefined : 'unavailable — recipes.popularity not populated'),
];
console.log(formatReport(reports));
process.exit(0);
