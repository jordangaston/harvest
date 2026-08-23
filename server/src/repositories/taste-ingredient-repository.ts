import { asc } from 'drizzle-orm';
import type { Database } from '../db.js';
import { tasteIngredients } from '../schema.js';

/** One base-ingredient picker option (taste overhaul). `value` is the `taste_ingredients.id`
 * (uuid) a pick stores; `section` is the picker's group header. */
export interface TasteIngredient {
  value: string;
  label: string;
  section: string;
}

/**
 * Reads the curated base-ingredient catalog (`taste_ingredients`) — the ingredient facet of
 * the taste-options catalog. Static reference rows, so no per-user scoping. Never hits the
 * network (the seeded local catalog).
 */
export class TasteIngredientRepository {
  constructor(private readonly db: Database) {}

  static create(db: Database): TasteIngredientRepository {
    return new TasteIngredientRepository(db);
  }

  /** All base ingredients, ordered by (section, label) for a stable, sectioned picker. */
  async ingredients(): Promise<TasteIngredient[]> {
    const rows = await this.db
      .select({ id: tasteIngredients.id, label: tasteIngredients.label, section: tasteIngredients.section })
      .from(tasteIngredients)
      .orderBy(asc(tasteIngredients.section), asc(tasteIngredients.label));
    return rows.map((r) => ({ value: r.id, label: r.label, section: r.section }));
  }
}
