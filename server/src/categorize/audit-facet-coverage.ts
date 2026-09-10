import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipes, recipeCategories } from '../schema.js';

/** Coverage of the two Tier-1-eligibility facets across the corpus. `withBoth` is the Tier 1
 * ceiling — a recipe needs both `cuisine` and `dish_type` to be a triplet anchor/candidate. The
 * gap lists are recipe ids missing that facet (a re-categorize target). */
export interface FacetCoverage {
  total: number;
  withCuisine: number;
  withDishType: number;
  withBoth: number;
  gapCuisine: string[];
  gapDishType: string[];
}

/** Read-only audit: how many recipes carry `cuisine` / `dish_type` / both, and which lack each.
 * No LLM, no writes — run before the backfill to size the gap. */
export async function auditFacetCoverage(db: Database): Promise<FacetCoverage> {
  const allIds = (await db.select({ id: recipes.id }).from(recipes)).map((r) => r.id);
  const cuisineIds = await recipeIdsWithFacet(db, 'cuisine');
  const dishIds = await recipeIdsWithFacet(db, 'dish_type');

  const gapCuisine = allIds.filter((id) => !cuisineIds.has(id));
  const gapDishType = allIds.filter((id) => !dishIds.has(id));
  return {
    total: allIds.length,
    withCuisine: cuisineIds.size,
    withDishType: dishIds.size,
    withBoth: allIds.filter((id) => cuisineIds.has(id) && dishIds.has(id)).length,
    gapCuisine,
    gapDishType,
  };
}

/** The set of recipe ids that have ≥1 row for `facet`. */
async function recipeIdsWithFacet(db: Database, facet: 'cuisine' | 'dish_type'): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ recipeId: recipeCategories.recipeId })
    .from(recipeCategories)
    .where(eq(recipeCategories.facet, facet));
  return new Set(rows.map((r) => r.recipeId));
}
