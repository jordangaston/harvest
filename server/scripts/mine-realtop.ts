import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { writeFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { loadModels } from '../src/eval/recsys/load-models.js';
import { rankIds } from '../src/eval/recsys/types.js';
import { goldFile } from '../src/eval/recsys/gold-paths.js';

/**
 * Tier 2 real-output mining (`labels:mine-realtop`, run with GOLD_SET=realtop): the representative
 * set — per sampled anchor, the UNION of each model's actual top-K (what a user would really see),
 * deduped, no random padding. Judging this set scores exactly the recommendations users get; each
 * model is later graded on its own top-K within the pool (P@10 = good-in-top-10, nDCG@10).
 * Writes `eval/gold/candidates.realtop.jsonl`.
 */
const SEED = 11;
const ANCHORS = 20;
const TOPK = 10;

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

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
console.log('loading models…');
const { allIds, idf, embedding } = await loadModels(client);

const anchors = [...allIds].sort(() => rng() - 0.5).slice(0, ANCHORS);
const pairs: { a: string; c: string; src: string }[] = [];
for (const anchor of anchors) {
  const others = allIds.filter((id) => id !== anchor);
  const idfTop = new Set(rankIds(idf, anchor, others).slice(0, TOPK));
  const embTop = new Set(rankIds(embedding, anchor, others).slice(0, TOPK));
  for (const c of new Set([...idfTop, ...embTop])) {
    const src = idfTop.has(c) && embTop.has(c) ? 'both' : idfTop.has(c) ? 'idf' : 'emb';
    pairs.push({ a: anchor, c, src });
  }
}

const header = JSON.stringify({ seed: SEED, anchors: ANCHORS, topK: TOPK, count: pairs.length, kind: 'realtop' });
const out = goldFile('candidates');
writeFileSync(out, [header, ...pairs.map((p) => JSON.stringify(p))].join('\n') + '\n');
const both = pairs.filter((p) => p.src === 'both').length;
console.log(`Wrote ${pairs.length} real-top pairs from ${anchors.length} anchors (${both} in both models' top-${TOPK}) → ${out}`);
process.exit(0);
