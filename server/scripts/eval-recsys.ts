import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { TasteRepository } from '../src/ranking/taste/taste-repository.js';
import { TasteSpace } from '../src/ranking/taste/taste-space.js';
import { idfRecommender, randomRecommender, embeddingRecommender } from '../src/eval/recsys/recommenders.js';
import { EmbeddingSpace, DEFAULT_OPTIONS } from '../src/ranking/embedding/embedding-space.js';
import { tripletAccuracy, type Triplet } from '../src/eval/recsys/triplets.js';
import { rareIngredientProbe } from '../src/eval/recsys/probes.js';
import { evaluateGraded, pairwiseConcordance, spearman, type LabeledQuery } from '../src/eval/recsys/metrics.js';
import { goldFile } from '../src/eval/recsys/gold-paths.js';

/**
 * recsys eval runner (`eval:recsys`) — Tier 1: triplet accuracy per model and the rare-ingredient
 * probe, through the eval-harness-core interface. Target DB from `TURSO_DATABASE_URL`. Triplets come
 * from the committed `eval/gold/triplets.jsonl` (`labels:triplets`).
 */
const GOLD = join(process.cwd(), 'eval', 'gold');

function loadTriplets(): Triplet[] {
  const path = join(GOLD, 'triplets.jsonl');
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const out: Triplet[] = [];
  for (const line of lines) {
    const o = JSON.parse(line) as { a?: string; pos?: string; neg?: string };
    if (o.a && o.pos && o.neg) out.push({ anchor: o.a, positive: o.pos, negative: o.neg });
  }
  return out;
}

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);
const profiles = await TasteRepository.create(db).allProfiles();
const space = new TasteSpace(profiles);
const idf = idfRecommender(space);
const random = randomRecommender();

// Embedding model: token bags = base ingredients (profile keys) + cuisine/dish-form pseudo-tokens.
const facetRows = (await client.execute("SELECT recipe_id, facet, value FROM recipe_categories WHERE facet IN ('cuisine','dish_type')")).rows as unknown as { recipe_id: string; facet: string; value: string }[];
const pseudo = new Map<string, string[]>();
for (const r of facetRows) {
  const list = pseudo.get(r.recipe_id) ?? [];
  list.push(`${r.facet}:${r.value}`);
  pseudo.set(r.recipe_id, list);
}
const bags = new Map<string, string[]>();
for (const [id, profile] of profiles) bags.set(id, [...Object.keys(profile), ...(pseudo.get(id) ?? [])]);
console.log(`building embedding space over ${bags.size} recipes (minDf=${DEFAULT_OPTIONS.minDf}, dims=${DEFAULT_OPTIONS.dims})…`);
const embedding = embeddingRecommender(EmbeddingSpace.build(bags, DEFAULT_OPTIONS));

const models = [embedding, idf, random];

// ── Triplet accuracy (Tier 1 headline) ──────────────────────────────────────
const tier1 = new Map<string, number>();
const triplets = loadTriplets();
if (triplets.length === 0) {
  console.log(`No eval/gold/triplets.jsonl — run \`npm run labels:triplets\` first.`);
} else {
  console.log(`triplet accuracy — ${triplets.length} triplets`);
  for (const m of models) {
    const s = tripletAccuracy(m, triplets);
    tier1.set(m.name, s.accuracy);
    console.log(`  ${m.name.padEnd(10)} ${s.accuracy.toFixed(3)}`);
  }
}

// ── Rare-ingredient probe (relative to IDF) ──────────────────────────────────
const dfRows = (await client.execute('SELECT base_ingredient_id, document_frequency FROM ingredient_distinctiveness')).rows as unknown as { base_ingredient_id: string; document_frequency: number }[];
const df = new Map(dfRows.map((r) => [r.base_ingredient_id, Number(r.document_frequency)]));
console.log(`\nrare-ingredient probe — top-10 share (df ≤ 5, ≤200 anchors)`);
for (const m of models) {
  const p = rareIngredientProbe(m, profiles, df, { dfThreshold: 5, topK: 10, maxAnchors: 200, seed: 42 });
  console.log(`  ${m.name.padEnd(10)} ${p.share.toFixed(3)}  (n=${p.n})`);
}

// ── Tier 2: graded metrics + Tier 1↔Tier 2 Spearman. Labels = DeepSeek drafts as the base,
// overridden by human verdicts (pairs) where present. ──
const draftsPath = goldFile('drafts');
const pairsPath = goldFile('pairs');
const readRel = (path: string) => {
  const m = new Map<string, number | null>();
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)) {
    const o = JSON.parse(line) as { a: string; c: string; rel: number | null };
    m.set(`${o.a}|${o.c}`, o.rel);
  }
  return m;
};
const base = readRel(draftsPath);
const human = readRel(pairsPath);
if (base.size === 0 && human.size === 0) {
  console.log(`\nTier 2: no labels yet — mine → draft → review in the portal first.`);
} else {
  const byAnchor = new Map<string, Record<string, number>>();
  for (const key of new Set([...base.keys(), ...human.keys()])) {
    const rel = human.has(key) ? human.get(key)! : base.get(key)!;
    if (rel == null) continue; // skipped
    const [a, c] = key.split('|');
    const labels = byAnchor.get(a!) ?? {};
    labels[c!] = rel;
    byAnchor.set(a!, labels);
  }
  const gold: LabeledQuery[] = [...byAnchor].map(([anchor, labels]) => ({ anchor, labels }));
  console.log(`\n(labels: ${human.size} human overrides on ${base.size} DeepSeek drafts)`);
  // Pairwise concordance is the headline: the mined pairs are max-disagreement + few-per-anchor, so
  // P@10/nDCG@10 barely discriminate (k > pool). Concordance scores each differently-labeled pair.
  const tier2 = new Map<string, number>();
  console.log(`\nTier 2 — pairwise concordance over ${gold.length} labeled anchors (nDCG@10 secondary)`);
  for (const m of models) {
    const c = pairwiseConcordance(m, gold);
    const g = evaluateGraded(m, gold, 10);
    tier2.set(m.name, c.concordance);
    console.log(`  ${m.name.padEnd(10)} concordance ${c.concordance.toFixed(3)} (${c.nPairs} pairs)  P@10 ${g.precisionAtK.toFixed(3)} (good-in-top-10)  nDCG@10 ${g.ndcgAtK.toFixed(3)}`);
  }
  const names = models.map((m) => m.name).filter((n) => tier1.has(n) && tier2.has(n));
  if (names.length >= 2) {
    const rho = spearman(names.map((n) => tier1.get(n)!), names.map((n) => tier2.get(n)!));
    console.log(`\nTier 1 ↔ Tier 2 Spearman (model ranking): ρ = ${rho.toFixed(3)}  ${rho >= 0.9 ? '→ Tier 1 validated as a proxy' : '→ proxy weak, investigate'}`);
  }
}
process.exit(0);
