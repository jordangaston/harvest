import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { loadModels } from '../src/eval/recsys/load-models.js';
import { rankIds } from '../src/eval/recsys/types.js';
import { goldFile } from '../src/eval/recsys/gold-paths.js';

/**
 * Tier 2 pooled mining (`labels:mine-pooled`, run with GOLD_SET=pooled): the unbiased,
 * TREC-style candidate set. Per sampled anchor, pool each model's top-N picks plus a random sample,
 * so both models' bests and a neutral baseline are judged together — no disagreement bias. Scoring
 * every model on this pool gives an overall-quality read (unlike the max-disagreement set, which
 * only says who's right on ties). Writes `eval/gold/candidates.pooled.jsonl`.
 */
const SEED = 7;
const ANCHORS = 35;
const TOPN = 3; // per model
const RANDOM_M = 3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
console.log('loading models…');
const { allIds, idf, embedding } = await loadModels(client);

const anchors = [...allIds].sort(() => rng() - 0.5).slice(0, ANCHORS);
const pairs: { a: string; c: string }[] = [];
for (const anchor of anchors) {
  const others = allIds.filter((id) => id !== anchor);
  const pool = new Set<string>();
  for (const id of rankIds(idf, anchor, others).slice(0, TOPN)) pool.add(id);
  for (const id of rankIds(embedding, anchor, others).slice(0, TOPN)) pool.add(id);
  for (let i = 0; i < RANDOM_M; i++) pool.add(pick(others));
  for (const c of pool) pairs.push({ a: anchor, c });
}

const header = JSON.stringify({ seed: SEED, anchors: ANCHORS, topN: TOPN, randomM: RANDOM_M, count: pairs.length, kind: 'pooled' });
const out = goldFile('candidates');
writeFileSync(out, [header, ...pairs.map((p) => JSON.stringify(p))].join('\n') + '\n');
console.log(`Wrote ${pairs.length} pooled pairs from ${anchors.length} anchors → ${out}`);
process.exit(0);
