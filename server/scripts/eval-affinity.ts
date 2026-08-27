import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { TasteRepository } from '../src/ranking/taste/taste-repository.js';
import { TasteSpace } from '../src/ranking/taste/taste-space.js';
import { cosine, centroid, type TasteProfile } from '../src/ranking/taste/taste-profile.js';

/**
 * Affinity eval (cuisine hold-out — a stand-in for held-out swipes until swipe volume exists):
 * for each cuisine, build an anchor from half its recipes and check whether the *held-out* half
 * ranks above off-cuisine recipes. AUC = P(held-out same-cuisine scores above a random other);
 * 0.5 = no signal, 1.0 = perfect. This is the number that would tune K, ε, and the SVD trigger.
 */
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const repo = TasteRepository.create(makeDb(client));
const space = new TasteSpace(await repo.allProfiles());

const byCuisine = new Map<string, string[]>();
for (const r of (await client.execute("select recipe_id, value from recipe_categories where facet='cuisine'")).rows) {
  const id = String(r.recipe_id);
  if (!space.profile(id)) continue;
  (byCuisine.get(String(r.value)) ?? byCuisine.set(String(r.value), []).get(String(r.value))!).push(id);
}
const allIds = [...new Set([...byCuisine.values()].flat())];
const profileOf = (id: string) => space.profile(id)!;

/** AUC via the Mann–Whitney rank-sum: fraction of (positive, negative) pairs scored correctly. */
function auc(scores: { s: number; pos: boolean }[]): number {
  const sorted = [...scores].sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let nPos = 0;
  sorted.forEach((x, i) => {
    if (x.pos) {
      rankSum += i + 1;
      nPos++;
    }
  });
  const nNeg = sorted.length - nPos;
  if (nPos === 0 || nNeg === 0) return NaN;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

const results: { cuisine: string; n: number; auc: number; recall: number }[] = [];
for (const [cuisine, ids] of byCuisine) {
  if (ids.length < 40) continue;
  const train = ids.filter((_, i) => i % 2 === 0);
  const test = new Set(ids.filter((_, i) => i % 2 === 1));
  const anchor: TasteProfile = centroid(train.map(profileOf));
  const scored = allIds
    .filter((id) => !train.includes(id))
    .map((id) => ({ id, s: cosine(anchor, profileOf(id)), pos: test.has(id) }));
  const a = auc(scored);
  const topN = [...scored].sort((x, y) => y.s - x.s).slice(0, test.size);
  const recall = topN.filter((x) => x.pos).length / test.size;
  results.push({ cuisine, n: ids.length, auc: a, recall });
}

results.sort((a, b) => b.n - a.n);
console.log('cuisine        n    AUC    recall@k');
for (const r of results)
  console.log(`${r.cuisine.padEnd(14)} ${String(r.n).padStart(4)}  ${r.auc.toFixed(3)}  ${r.recall.toFixed(3)}`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`\nmean AUC ${mean(results.map((r) => r.auc)).toFixed(3)} · mean recall ${mean(results.map((r) => r.recall)).toFixed(3)} (over ${results.length} cuisines)`);
process.exit(0);
