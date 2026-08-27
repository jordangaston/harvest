import { eq, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { type Database } from '../../db.js';
import { recipeTasteProfiles, recipeCategories, recipeSwipes, userFoodPrefs, AFFINITY_FACETS } from '../../schema.js';
import type { TasteProfile } from './taste-profile.js';

/** The facets a user can state a like/dislike on. */
export type AffinityFacet = (typeof AFFINITY_FACETS)[number];
/** Facets backed by a recipe category tag — everything except the direct `ingredient` dimension. */
export type CategoryFacet = Exclude<AffinityFacet, 'ingredient'>;

/** A stored taste profile is a sparse map of finite weights — validated at the DB→domain boundary. */
const WeightsSchema = z.record(z.string(), z.number().finite());

/** Reads for the taste-space feature: recipe profiles, facet→recipes, and a user's swipes/food prefs. */
export class TasteRepository {
  constructor(private readonly db: Database) {}

  static create(db: Database): TasteRepository {
    return new TasteRepository(db);
  }

  /** Every recipe's taste profile, keyed by id — loaded once into the in-memory TasteSpace. */
  async allProfiles(): Promise<Map<string, TasteProfile>> {
    const rows = await this.db
      .select({ recipeId: recipeTasteProfiles.recipeId, weights: recipeTasteProfiles.weights })
      .from(recipeTasteProfiles);
    return new Map(rows.map((r) => [r.recipeId, WeightsSchema.parse(r.weights)]));
  }

  /** Recipe ids carrying a facet value (e.g. cuisine=italian) — the members a centroid averages. */
  async recipeIdsByFacet(facet: CategoryFacet, value: string): Promise<string[]> {
    const rows = await this.db
      .select({ recipeId: recipeCategories.recipeId })
      .from(recipeCategories)
      .where(and(eq(recipeCategories.facet, facet), eq(recipeCategories.value, value)));
    return rows.map((r) => r.recipeId);
  }

  /** Recipe ids for many facet values in ONE query, keyed `facet:value` (avoids per-pref N+1). */
  async recipeIdsByFacets(
    pairs: readonly { facet: CategoryFacet; value: string }[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (pairs.length === 0) return out;
    const rows = await this.db
      .select({ facet: recipeCategories.facet, value: recipeCategories.value, recipeId: recipeCategories.recipeId })
      .from(recipeCategories)
      .where(or(...pairs.map((p) => and(eq(recipeCategories.facet, p.facet), eq(recipeCategories.value, p.value)))));
    for (const r of rows) {
      const key = `${r.facet}:${r.value}`;
      const list = out.get(key);
      if (list) list.push(r.recipeId);
      else out.set(key, [r.recipeId]);
    }
    return out;
  }

  /** A user's swipes; `direction` is the swipe enum (like/dislike/save). */
  async userSwipes(userId: string) {
    return this.db
      .select({ recipeId: recipeSwipes.recipeId, direction: recipeSwipes.direction })
      .from(recipeSwipes)
      .where(eq(recipeSwipes.userId, userId));
  }

  /** A user's stated food prefs; `facet`/`sentiment` are their enums. */
  async userFoodPrefs(userId: string) {
    return this.db
      .select({ facet: userFoodPrefs.facet, value: userFoodPrefs.value, sentiment: userFoodPrefs.sentiment })
      .from(userFoodPrefs)
      .where(eq(userFoodPrefs.userId, userId));
  }
}
