import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipeCategories } from '../schema.js';

/**
 * One-shot data fold for the vocab change "a burger is a sandwich": re-tags existing
 * `dish_type='burger'` rows to `dish_type='sandwich'`. A recipe already carrying `sandwich` would
 * collide on the composite PK, so its `burger` row is deleted instead (deduped). Idempotent — a
 * re-run finds no `burger` rows. Returns how many were renamed vs deduped.
 */
export async function foldBurgerToSandwich(db: Database): Promise<{ folded: number; deduped: number }> {
  const sandwichIds = (
    await db
      .select({ id: recipeCategories.recipeId })
      .from(recipeCategories)
      .where(and(eq(recipeCategories.facet, 'dish_type'), eq(recipeCategories.value, 'sandwich')))
  ).map((r) => r.id);

  let deduped = 0;
  if (sandwichIds.length > 0) {
    const del = await db
      .delete(recipeCategories)
      .where(and(eq(recipeCategories.facet, 'dish_type'), eq(recipeCategories.value, 'burger'), inArray(recipeCategories.recipeId, sandwichIds)))
      .returning({ value: recipeCategories.value });
    deduped = del.length;
  }

  const renamed = await db
    .update(recipeCategories)
    .set({ value: 'sandwich' })
    .where(and(eq(recipeCategories.facet, 'dish_type'), eq(recipeCategories.value, 'burger')))
    .returning({ value: recipeCategories.value });

  return { folded: renamed.length, deduped };
}
