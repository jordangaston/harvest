import { GroceryRepository } from '../repositories/grocery-repository.js';
import { GroceryCatalog } from '../grocery/catalog.js';
import { type GroceryItem } from '../models/grocery-item.js';
import type { CatalogEntry } from '../grocery/aisle-map.js';
import type { Database } from '../db.js';
import { NotFoundError } from '../errors.js';

/** One item to add — from the manual sheet (one) or a recipe (many). */
export interface AddGroceryItem {
  name: string;
  amount?: number | null;
  unit?: string | null;
  quantityText?: string | null;
  sourceRecipeId?: string | null;
}

/**
 * Grocery-list reads and writes. The single chokepoint for the add invariant:
 * resolve each item's aisle/icon/default-unit from the catalog, then merge into an
 * existing line (same name + unit) or insert. Manual and recipe adds both route here.
 */
export class GroceryService {
  constructor(
    private readonly items: GroceryRepository,
    private readonly catalog: GroceryCatalog,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): GroceryService {
    return new GroceryService(GroceryRepository.create(db), GroceryCatalog.create());
  }

  /**
   * Adds items to a household's list. Each item is resolved (aisle, icon, default unit)
   * then merged by name + compatible unit when it carries a numeric amount, else inserted.
   * @param householdId - Owning household.
   * @param items - Items to add; blank names are skipped.
   * @param addedBy - The caller, recorded as `added_by_user_id` (attribution only). Null for
   *   system-sourced adds (e.g. the plan sync).
   * @returns The created or merged rows, in input order.
   */
  async add(householdId: string, items: AddGroceryItem[], addedBy: string | null = null): Promise<GroceryItem[]> {
    const result: GroceryItem[] = [];
    for (const raw of items) {
      const name = raw.name.trim();
      if (!name) continue;
      const resolved = this.catalog.resolve(name);
      const amount = raw.amount ?? null;
      // Sensible default: a numeric amount with no unit gets the catalog's default.
      const unit = raw.unit ?? (amount !== null ? resolved.defaultUnit : null);
      const candidate = amount !== null ? await this.items.findMergeCandidate(householdId, name, unit) : undefined;
      if (candidate) {
        result.push(await this.items.addAmount(candidate.id, amount!));
      } else {
        result.push(
          await this.items.insert(householdId, {
            name,
            amount,
            unit,
            quantityText: raw.quantityText ?? null,
            aisle: resolved.aisle,
            icon: resolved.iconKey,
            sourceRecipeId: raw.sourceRecipeId ?? null,
            addedByUserId: addedBy,
          }),
        );
      }
    }
    return result;
  }

  /** The household's whole list. */
  list(householdId: string): Promise<GroceryItem[]> {
    return this.items.listByHousehold(householdId);
  }

  /**
   * Patches one of the household's items (check off / edit quantity).
   * @throws {NotFoundError} 404 if the item isn't the household's.
   */
  async patch(
    householdId: string,
    id: string,
    patch: { checked?: boolean; amount?: number | null; unit?: string | null },
  ): Promise<GroceryItem> {
    const updated = await this.items.patch(householdId, id, patch);
    if (!updated) throw new NotFoundError();
    return updated;
  }

  /**
   * Removes one of the household's items.
   * @throws {NotFoundError} 404 if the item isn't the household's.
   */
  async remove(householdId: string, id: string): Promise<void> {
    if (!(await this.items.remove(householdId, id))) throw new NotFoundError();
  }

  /** The common-ingredients list for the picker + Meal Planning. */
  common(query?: string): CatalogEntry[] {
    return this.catalog.common(query);
  }
}
