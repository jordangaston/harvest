import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { buildTriplets, type RecipeFacets } from '../src/eval/recsys/triplets.js';

/**
 * Tier 1 triplet generator (`labels:triplets`): reads every recipe's cuisine + dish_type facets and
 * writes a deterministic, versioned triplet set to `eval/gold/triplets.jsonl` (a header line with
 * the seed + count, then one `{a,pos,neg}` per line). Commit the output — the frozen set is what
 * makes triplet-accuracy numbers comparable over time. Target DB from `TURSO_DATABASE_URL`.
 */
const SEED = 42;
const CAP_PER_ANCHOR = 3;
const MAX_ANCHORS = 2500;

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const rows = (await client.execute("SELECT recipe_id, facet, value FROM recipe_categories WHERE facet IN ('cuisine','dish_type')")).rows as unknown as { recipe_id: string; facet: string; value: string }[];
const byId = new Map<string, RecipeFacets>();
for (const r of rows) {
  const rf = byId.get(r.recipe_id) ?? { id: r.recipe_id, cuisines: [], dishTypes: [] };
  (r.facet === 'cuisine' ? rf.cuisines : rf.dishTypes).push(r.value);
  byId.set(r.recipe_id, rf);
}

const triplets = buildTriplets([...byId.values()], { seed: SEED, capPerAnchor: CAP_PER_ANCHOR, maxAnchors: MAX_ANCHORS });
const header = JSON.stringify({ seed: SEED, capPerAnchor: CAP_PER_ANCHOR, maxAnchors: MAX_ANCHORS, count: triplets.length, axes: ['cuisine', 'dish_type'] });
const lines = [header, ...triplets.map((t) => JSON.stringify({ a: t.anchor, pos: t.positive, neg: t.negative }))];
const out = join(process.cwd(), 'eval', 'gold', 'triplets.jsonl');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${triplets.length} triplets from ${byId.size} recipes → ${out}`);
process.exit(0);
