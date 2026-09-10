import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db.js';
import { recipeCategories } from '../schema.js';
import { VOCAB } from './vocab.js';

/**
 * One-shot data move for the course/form facet split: existing recipes already carry the role words
 * (`appetizer`/`main_course`/`side_dish`/`dessert`) under `facet='dish_type'`; this re-tags those
 * rows to the new `course` facet. No recompute — the values are unchanged, only their facet moves.
 * Idempotent: a re-run matches nothing (the rows are already `course`). Returns the count moved.
 */
export async function backfillCourseFacet(db: Database): Promise<{ rowsMoved: number }> {
  const moved = await db
    .update(recipeCategories)
    .set({ facet: 'course' })
    .where(and(eq(recipeCategories.facet, 'dish_type'), inArray(recipeCategories.value, [...VOCAB.course])))
    .returning({ value: recipeCategories.value });
  return { rowsMoved: moved.length };
}
