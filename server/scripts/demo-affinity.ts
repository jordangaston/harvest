import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { TasteRepository } from '../src/ranking/taste/taste-repository.js';
import { TasteSpace, type AnchorSet } from '../src/ranking/taste/taste-space.js';
import { FacetTasteProfileService } from '../src/ranking/taste/facet-taste-profile-service.js';

/** Demonstrates affinity-driven sourcing on the real corpus: what deck does a given taste produce? */
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const repo = TasteRepository.create(makeDb(client));
const space = new TasteSpace(await repo.allProfiles());
const facets = FacetTasteProfileService.create(space, repo);

const titles = new Map(
  (await client.execute('select id,title from recipes')).rows.map((r) => [String(r.id), String(r.title)]),
);
const cuisineOf = new Map<string, string>();
for (const r of (await client.execute("select recipe_id,value from recipe_categories where facet='cuisine'")).rows)
  cuisineOf.set(String(r.recipe_id), String(r.value));
const allIds = [...titles.keys()].filter((id) => space.profile(id));

function show(label: string, ids: string[] | null): void {
  console.log(`\n### ${label}`);
  if (!ids) return void console.log('  (no anchors → fallback)');
  const mix: Record<string, number> = {};
  for (const id of ids.slice(0, 10)) {
    const c = cuisineOf.get(id) ?? '?';
    mix[c] = (mix[c] ?? 0) + 1;
    console.log(`  [${c}] ${titles.get(id)}`);
  }
  console.log('  cuisine mix (top10):', JSON.stringify(mix));
}

const set = (anchors: AnchorSet['anchors'], dislikes: AnchorSet['dislikes'] = []): AnchorSet => ({ anchors, dislikes });

const italian = await facets.tasteProfile('cuisine', 'italian');
const thai = await facets.tasteProfile('cuisine', 'thai');
show('likes Italian (facet anchor)', space.source(set([{ profile: italian, weight: 1 }]), allIds, 10));

const thaiSeed = [...cuisineOf].find(([id, c]) => c === 'thai' && space.profile(id))![0];
console.log(`\nseed recipe → "${titles.get(thaiSeed)}"`);
show('likes ONE Thai recipe (recipe anchor)', space.source(set([{ profile: space.profile(thaiSeed)!, weight: 1 }]), allIds, 10));

show('likes Italian, DISLIKES Thai', space.source(set([{ profile: italian, weight: 1 }], [thai]), allIds, 10));
process.exit(0);
