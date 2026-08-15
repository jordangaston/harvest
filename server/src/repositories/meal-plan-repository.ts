import { and, eq, gte, lte, asc, sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { mealPlanEntries, recipes } from '../db/schema/index.js';
import type { MealPlanEntryView, MealSlot } from '../models/meal-plan.js';

/**
 * Meal-plan entries: one recipe assigned to a (date, meal) slot. Entries are
 * owner-scoped; a slot holds many recipes ordered by `position`. A deleted recipe
 * or user cascades its entries away via FKs.
 */
export class MealPlanRepository {
  constructor(private readonly db: Database) {}

  /** Wire dependencies from the shared singletons. */
  static create(): MealPlanRepository {
    return new MealPlanRepository(db);
  }

  /**
   * The caller's entries with `start <= date <= end`, each joined to its recipe
   * card, ordered by date, then meal (Breakfast→Lunch→Dinner→Snack, the enum's
   * declaration order), then position.
   * @param userId - Owner.
   * @param start - Inclusive ISO date (YYYY-MM-DD).
   * @param end - Inclusive ISO date (YYYY-MM-DD).
   */
  async listRange(userId: string, start: string, end: string): Promise<MealPlanEntryView[]> {
    const rows = await this.db
      .select({
        id: mealPlanEntries.id,
        date: mealPlanEntries.date,
        meal: mealPlanEntries.meal,
        position: mealPlanEntries.position,
        recipeId: recipes.id,
        title: recipes.title,
        imageUrl: recipes.imageUrl,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
      .where(and(eq(mealPlanEntries.userId, userId), gte(mealPlanEntries.date, start), lte(mealPlanEntries.date, end)))
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.meal), asc(mealPlanEntries.position));
    return rows.map(toView);
  }

  /**
   * Appends a recipe to a (date, meal) slot at the next position. One transaction
   * so the position read and insert commit together.
   * @param userId - Owner.
   * @param date - ISO date (YYYY-MM-DD).
   * @param meal - Meal slot.
   * @param recipeId - Recipe to assign (existence checked by the service).
   * @returns The created entry joined to its recipe card.
   */
  async add(userId: string, date: string, meal: MealSlot, recipeId: string): Promise<MealPlanEntryView> {
    return this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mealPlanEntries.position}), -1) + 1` })
        .from(mealPlanEntries)
        .where(and(eq(mealPlanEntries.userId, userId), eq(mealPlanEntries.date, date), eq(mealPlanEntries.meal, meal)));
      const [row] = await tx
        .insert(mealPlanEntries)
        .values({ userId, date, meal, recipeId, position: next })
        .returning({ id: mealPlanEntries.id });
      const [card] = await tx
        .select({ recipeId: recipes.id, title: recipes.title, imageUrl: recipes.imageUrl })
        .from(recipes)
        .where(eq(recipes.id, recipeId));
      return toView({ id: row.id, date, meal, position: next, ...card });
    });
  }

  /**
   * Removes one of the caller's entries.
   * @param userId - Owner; another user's entry id removes nothing.
   * @param entryId - Entry to remove.
   * @returns true if a row was deleted (else the caller should 404).
   */
  async remove(userId: string, entryId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(mealPlanEntries)
      .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlanEntries.userId, userId)))
      .returning({ id: mealPlanEntries.id });
    return deleted.length > 0;
  }
}

/** Shapes a joined row into the public entry view (omits a null image). */
function toView(row: {
  id: string;
  date: string;
  meal: MealSlot;
  position: number;
  recipeId: string;
  title: string;
  imageUrl: string | null;
}): MealPlanEntryView {
  const recipe = row.imageUrl
    ? { id: row.recipeId, title: row.title, image_url: row.imageUrl }
    : { id: row.recipeId, title: row.title };
  return { id: row.id, date: row.date, meal: row.meal, position: row.position, recipe };
}
