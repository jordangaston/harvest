import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { TasteRepository } from '../src/ranking/taste/taste-repository.js';
import { TasteSpace } from '../src/ranking/taste/taste-space.js';
import { idfRecommender, embeddingRecommender } from '../src/eval/recsys/recommenders.js';
import { EmbeddingSpace, DEFAULT_OPTIONS } from '../src/ranking/embedding/embedding-space.js';
import { mineDisagreements } from '../src/eval/recsys/mine.js';
import { rankIds } from '../src/eval/recsys/types.js';

/**
 * Tier 2 mining (`labels:mine`): find the candidates IDF and the embedding model rank most
 * differently for a sample of anchors — the discriminating pairs a human should label. Writes
 * `eval/gold/candidates.jsonl` (header + one pair per line). Target DB from `TURSO_DATABASE_URL`.
 */
const SEED = 42;
const ANCHORS = 50;
const PER_ANCHOR = 6;
const POOL_TOPN = 20; // union of each model's top-N is the candidate pool per anchor

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const profiles = await TasteRepository.create(makeDb(client)).allProfiles();
const idf = idfRecommender(new TasteSpace(profiles));

const facetRows = (await client.execute("SELECT recipe_id, facet, value FROM recipe_categories WHERE facet IN ('cuisine','dish_type')")).rows as unknown as { recipe_id: string; facet: string; value: string }[];
const pseudo = new Map<string, string[]>();
for (const r of facetRows) {
  const list = pseudo.get(r.recipe_id) ?? [];
  list.push(`${r.facet}:${r.value}`);
  pseudo.set(r.recipe_id, list);
}
const bags = new Map<string, string[]>();
for (const [id, p] of profiles) bags.set(id, [...Object.keys(p), ...(pseudo.get(id) ?? [])]);
console.log(`building embedding space over ${bags.size} recipes…`);
const embedding = embeddingRecommender(EmbeddingSpace.build(bags, DEFAULT_OPTIONS));

// Sample anchors deterministically from recipes that have a profile (so both models can rank).
const allIds = [...profiles.keys()].sort();
const rng = mulberry32(SEED);
const shuffled = [...allIds].sort(() => rng() - 0.5).slice(0, ANCHORS);

const pairs = [];
for (const anchor of shuffled) {
  const others = allIds.filter((id) => id !== anchor);
  const pool = new Set<string>();
  for (const id of rankIds(idf, anchor, others).slice(0, POOL_TOPN)) pool.add(id);
  for (const id of rankIds(embedding, anchor, others).slice(0, POOL_TOPN)) pool.add(id);
  pairs.push(...mineDisagreements(anchor, [...pool], idf, embedding, PER_ANCHOR));
}

const header = JSON.stringify({ seed: SEED, anchors: ANCHORS, perAnchor: PER_ANCHOR, poolTopN: POOL_TOPN, count: pairs.length });
const lines = [header, ...pairs.map((p) => JSON.stringify({ a: p.anchor, c: p.candidate, rankIdf: p.rankA, rankEmb: p.rankB, dis: p.disagreement }))];
const out = join(process.cwd(), 'eval', 'gold', 'candidates.jsonl');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${pairs.length} disagreement pairs from ${shuffled.length} anchors → ${out}`);
process.exit(0);
