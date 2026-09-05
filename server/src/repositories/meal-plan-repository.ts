import { and, eq, gte, lte, asc, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { mealPlanEntries, recipes } from '../schema.js';
import type { MealPlanEntryView, MealPlanSource, MealSlot } from '../models/meal-plan.js';

/** A planner-chosen entry to persist: which slot, which recipe, and its main-first position. */
export interface GeneratedEntry {
  date: string;
  meal: MealSlot;
  recipeId: string;
  position: number;
}

/**
 * Meal-plan entries: one recipe assigned to a (date, meal) slot. Entries are
 * owner-scoped; a slot holds many recipes ordered by `position`. A deleted recipe
 * or user cascades its entries away via FKs.
 */
export class MealPlanRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): MealPlanRepository {
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
        source: mealPlanEntries.source,
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
   * @param source - Who set it: 'manual' (a user pick, the default) or 'generated' (the planner).
   * @returns The created entry joined to its recipe card.
   */
  async add(userId: string, date: string, meal: MealSlot, recipeId: string, source: MealPlanSource = 'manual'): Promise<MealPlanEntryView> {
    return this.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${mealPlanEntries.position}), -1) + 1` })
        .from(mealPlanEntries)
        .where(and(eq(mealPlanEntries.userId, userId), eq(mealPlanEntries.date, date), eq(mealPlanEntries.meal, meal)));
      const [row] = await tx
        .insert(mealPlanEntries)
        .values({ userId, date, meal, recipeId, position: next, source })
        .returning({ id: mealPlanEntries.id });
      const [card] = await tx
        .select({ recipeId: recipes.id, title: recipes.title, imageUrl: recipes.imageUrl })
        .from(recipes)
        .where(eq(recipes.id, recipeId));
      return toView({ id: row.id, date, meal, position: next, source, ...card });
    });
  }

  /**
   * Replaces the user's `generated` entries in an inclusive date range with a fresh set, in one
   * transaction — a regenerate. `manual` entries are left untouched, so a deliberate pick survives.
   * Positions come from the caller (main-first). Recipe existence is the caller's concern.
   * @param userId - Owner.
   * @param start - Inclusive ISO date (YYYY-MM-DD).
   * @param end - Inclusive ISO date (YYYY-MM-DD).
   * @param entries - The generated entries to insert.
   */
  async replaceGenerated(userId: string, start: string, end: string, entries: GeneratedEntry[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(mealPlanEntries)
        .where(and(eq(mealPlanEntries.userId, userId), gte(mealPlanEntries.date, start), lte(mealPlanEntries.date, end), eq(mealPlanEntries.source, 'generated')));
      if (entries.length)
        await tx.insert(mealPlanEntries).values(entries.map((e) => ({ userId, date: e.date, meal: e.meal, recipeId: e.recipeId, position: e.position, source: 'generated' as const })));
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

  /**
   * Removes one recipe from a (date, meal) slot, whatever its source. Deletes at most one row
   * (the lowest-position match) so removing a repeated recipe drops a single entry.
   * @returns true if a row was deleted (else the caller should 404).
   */
  async removeFromSlot(userId: string, date: string, meal: MealSlot, recipeId: string): Promise<boolean> {
    const [match] = await this.db
      .select({ id: mealPlanEntries.id })
      .from(mealPlanEntries)
      .where(and(eq(mealPlanEntries.userId, userId), eq(mealPlanEntries.date, date), eq(mealPlanEntries.meal, meal), eq(mealPlanEntries.recipeId, recipeId)))
      .orderBy(asc(mealPlanEntries.position))
      .limit(1);
    if (!match) return false;
    await this.db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, match.id));
    return true;
  }
}

/** Shapes a joined row into the public entry view (omits a null image). */
function toView(row: {
  id: string;
  date: string;
  meal: MealSlot;
  position: number;
  source: MealPlanSource;
  recipeId: string;
  title: string;
  imageUrl: string | null;
}): MealPlanEntryView {
  const recipe = row.imageUrl
    ? { id: row.recipeId, title: row.title, image_url: row.imageUrl }
    : { id: row.recipeId, title: row.title };
  return { id: row.id, date: row.date, meal: row.meal, position: row.position, source: row.source, recipe };
}
