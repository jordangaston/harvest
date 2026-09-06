import { and, eq, sql, asc, getTableColumns } from 'drizzle-orm';
import type { Database } from '../db.js';
import { groceryItems, recipes } from '../schema.js';
import { GroceryItemSchema, type GroceryItem } from '../models/grocery-item.js';

/** Fields the service hands the repository to insert one item. */
export interface InsertGroceryItem {
  name: string;
  amount: number | null;
  unit: string | null;
  quantityText: string | null;
  aisle: GroceryItem['aisle'];
  icon: string;
  sourceRecipeId: string | null;
  addedByUserId: string | null;
}

/**
 * The household grocery list. One flat table; the merge decision (sum vs. new row)
 * lives in the service, this exposes the primitives it needs. Every read/write is
 * scoped by `household_id` (attribution — who added a row — is free on `added_by_user_id`).
 */
export class GroceryRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): GroceryRepository {
    return new GroceryRepository(db);
  }

  /** The household's whole list (with each item's source recipe title, for the by-recipe
   * sort), oldest-first within the stable position order. */
  async listByHousehold(householdId: string): Promise<GroceryItem[]> {
    const rows = await this.db
      .select({ ...getTableColumns(groceryItems), sourceRecipeTitle: recipes.title })
      .from(groceryItems)
      .leftJoin(recipes, eq(recipes.id, groceryItems.sourceRecipeId))
      .where(eq(groceryItems.householdId, householdId))
      .orderBy(asc(groceryItems.position), asc(groceryItems.createdAt));
    return rows.map((r) => GroceryItemSchema.parse(r));
  }

  /**
   * Finds an existing merge target: the household's item with the same name (case-insensitive)
   * and the same unit that already carries a numeric amount. Null-safe on unit.
   */
  async findMergeCandidate(householdId: string, name: string, unit: string | null): Promise<GroceryItem | undefined> {
    const [row] = await this.db
      .select()
      .from(groceryItems)
      .where(
        and(
          eq(groceryItems.householdId, householdId),
          sql`lower(${groceryItems.name}) = lower(${name})`,
          sql`${groceryItems.unit} is not distinct from ${unit}`,
          sql`${groceryItems.amount} is not null`,
        ),
      )
      .limit(1);
    return row ? GroceryItemSchema.parse(row) : undefined;
  }

  /** Inserts a new item; `numeric` amount is bound as a string. */
  async insert(householdId: string, item: InsertGroceryItem): Promise<GroceryItem> {
    const [row] = await this.db
      .insert(groceryItems)
      .values({
        householdId,
        addedByUserId: item.addedByUserId,
        name: item.name,
        amount: item.amount == null ? null : String(item.amount),
        unit: item.unit,
        quantityText: item.quantityText,
        aisle: item.aisle,
        icon: item.icon,
        sourceRecipeId: item.sourceRecipeId,
      })
      .returning();
    return GroceryItemSchema.parse(row);
  }

  /** Adds `delta` to an item's amount (merge path). */
  async addAmount(id: string, delta: number): Promise<GroceryItem> {
    const [row] = await this.db
      .update(groceryItems)
      .set({ amount: sql`${groceryItems.amount} + ${String(delta)}` })
      .where(eq(groceryItems.id, id))
      .returning();
    return GroceryItemSchema.parse(row);
  }

  /**
   * Applies a household-scoped patch (checked / amount / unit). Returns undefined if the
   * item isn't the household's, so the service can 404.
   */
  async patch(
    householdId: string,
    id: string,
    patch: { checked?: boolean; amount?: number | null; unit?: string | null },
  ): Promise<GroceryItem | undefined> {
    const values: Record<string, unknown> = {};
    if (patch.checked !== undefined) values.checked = patch.checked;
    if (patch.amount !== undefined) values.amount = patch.amount == null ? null : String(patch.amount);
    if (patch.unit !== undefined) values.unit = patch.unit;
    const [row] = await this.db
      .update(groceryItems)
      .set(values)
      .where(and(eq(groceryItems.id, id), eq(groceryItems.householdId, householdId)))
      .returning();
    return row ? GroceryItemSchema.parse(row) : undefined;
  }

  /** Deletes a household's item; returns false if it wasn't theirs. */
  async remove(householdId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(groceryItems)
      .where(and(eq(groceryItems.id, id), eq(groceryItems.householdId, householdId)))
      .returning({ id: groceryItems.id });
    return rows.length > 0;
  }
}
