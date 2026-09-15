import type { Client } from '@libsql/client';
import { makeDb } from '../../db.js';
import { TasteRepository } from '../../ranking/taste/taste-repository.js';
import { TasteSpace } from '../../ranking/taste/taste-space.js';
import type { TasteProfile } from '../../ranking/taste/taste-profile.js';
import { EmbeddingSpace, DEFAULT_OPTIONS } from '../../ranking/embedding/embedding-space.js';
import { idfRecommender, embeddingRecommender } from './recommenders.js';
import type { Recommender } from './types.js';

/** The corpus + wired recommenders every eval/mining script needs — the IDF taste space and the
 * co-occurrence embedding (base ingredients + cuisine/dish pseudo-tokens), built once from the db. */
export interface RecsysModels {
  profiles: Map<string, TasteProfile>;
  allIds: string[];
  idf: Recommender;
  embedding: Recommender;
}

export async function loadModels(client: Client): Promise<RecsysModels> {
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
  const embedding = embeddingRecommender(EmbeddingSpace.build(bags, DEFAULT_OPTIONS));

  return { profiles, allIds: [...profiles.keys()], idf, embedding };
}
