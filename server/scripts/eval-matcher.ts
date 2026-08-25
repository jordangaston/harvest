import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { FdcFoodRepository } from '../src/nutrition/fdc-food-repository.js';
import { normalize } from '../src/nutrition/normalize.js';
import { rrfFuse } from '../src/nutrition/retrieval/rrf.js';
import { diceSimilarity } from '../src/nutrition/retrieval/similarity.js';

/**
 * Matcher accuracy eval. Runs the hybrid retrieval (trigram + word → RRF) once per distinct
 * ingredient name, then sweeps the reject-floor threshold in memory (the floor is post-hoc, so no
 * re-backfill per value). Reports, per threshold: match rate, the zero-content-overlap error proxy,
 * and the base-ingredient rollup rate. Picks the tuning point (Q-02).
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const repo = FdcFoodRepository.create(makeDb(client));

const STOP = new Set(
  'fresh chopped ground raw cooked nfs ns dried whole large small medium thinly sliced minced grated to taste and or of the with without for extra virgin optional plus more'.split(
    ' ',
  ),
);
const contentTokens = (s: string) =>
  new Set((s || '').toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []);
const overlaps = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true;
  for (const x of a) for (const y of b) if (x.includes(y) || y.includes(x)) return true;
  return false;
};

const withBase = new Set<number>();
for (const r of (await client.execute('select fdc_id from fdc_foods where base_ingredient_id is not null')).rows)
  withBase.add(Number(r.fdc_id));

const names = (
  await client.execute("select distinct name from ingredients where name is not null and name <> ''")
).rows.map((r) => String(r.name));

// One retrieval pass: per name, record the fused top's max-token dice, whether it's a proxy-wrong
// match, and whether it rolls up to a base ingredient.
type Row = { maxDice: number; wrong: boolean; base: boolean } | null;
const results: Row[] = [];
for (let i = 0; i < names.length; i++) {
  const name = names[i]!;
  const tokens = normalize(name);
  const [trig, word] = await Promise.all([repo.searchTrigrams(tokens), repo.searchWords(tokens)]);
  const topId = rrfFuse([trig.map((c) => c.fdcId), word.map((c) => c.fdcId)])[0];
  if (topId === undefined) {
    results.push(null);
    continue;
  }
  const cand = [...trig, ...word].find((c) => c.fdcId === topId)!;
  const foodTokens = cand.descriptionNormalized.split(/\s+/).filter(Boolean);
  let maxDice = 0;
  for (const t of tokens) for (const f of foodTokens) maxDice = Math.max(maxDice, diceSimilarity(t, f));
  results.push({
    maxDice,
    wrong: !overlaps(contentTokens(name), contentTokens(cand.description)),
    base: withBase.has(topId),
  });
  if ((i + 1) % 3000 === 0) console.error(`  retrieved ${i + 1}/${names.length}`);
}

const total = names.length;
console.log(`\n${total} distinct names · retrieval done. floor sweep (θ = min token dice to accept):\n`);
console.log('  θ      matched   error%   base-rollup%');
for (const theta of [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85]) {
  let matched = 0;
  let wrong = 0;
  let base = 0;
  for (const r of results) {
    if (!r || r.maxDice < theta) continue;
    matched++;
    if (r.wrong) wrong++;
    if (r.base) base++;
  }
  const err = matched ? (100 * wrong) / matched : 0;
  console.log(
    `  ${theta.toFixed(2)}   ${((100 * matched) / total).toFixed(1)}%    ${err.toFixed(2)}%    ${((100 * base) / total).toFixed(1)}%`,
  );
}
process.exit(0);
