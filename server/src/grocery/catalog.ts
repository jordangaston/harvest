import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mapIngredientIcon } from '../parse/icons.js';
import { AISLE_DEFAULT_UNIT, type CatalogEntry } from './aisle-map.js';
import type { GroceryAisle } from '../schema.js';

// DECISION (serverless port): the 18.7 KB catalog is static reference data, not
// per-user rows — it stays a BUNDLED JSON read once via readFileSync (works in the
// Vercel Node runtime and offline in tests). Only per-user `grocery_items` live in
// Turso; the catalog is never seeded into the DB.
const CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'grocery-catalog.json');

/** What resolving a raw ingredient name yields: where it lives + how to draw + buy it. */
export interface Resolved {
  aisle: GroceryAisle;
  iconKey: string;
  defaultUnit: string;
}

/**
 * The committed grocery catalog (built offline from USDA Foundation Foods). Loaded
 * once and used to (a) resolve a typed/recipe ingredient to its aisle, icon, and
 * default unit, and (b) serve the common-ingredients picker. Static reference data —
 * no table, no network.
 */
export class GroceryCatalog {
  private readonly byIcon = new Map<string, CatalogEntry>();

  constructor(private readonly entries: CatalogEntry[]) {
    // First entry per icon key wins — every entry sharing an icon is the same
    // ingredient identity, so they share an aisle.
    for (const e of entries) if (e.iconKey !== 'default' && !this.byIcon.has(e.iconKey)) this.byIcon.set(e.iconKey, e);
  }

  /** Load from the committed seed file. */
  static create(): GroceryCatalog {
    return new GroceryCatalog(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as CatalogEntry[]);
  }

  /**
   * Resolves a raw ingredient name to its aisle, icon key, and default unit. Routes
   * through the shared icon keyword map so any phrasing ("2 boneless chicken thighs"
   * → `chicken`) lands consistently; an unrecognized ingredient falls to `other`.
   * @param name - The ingredient name (any casing; prep words are tolerated).
   */
  resolve(name: string): Resolved {
    const iconKey = mapIngredientIcon(name);
    const entry = this.byIcon.get(iconKey);
    if (entry) return { aisle: entry.aisle, iconKey, defaultUnit: entry.defaultUnit };
    return { aisle: 'other', iconKey, defaultUnit: AISLE_DEFAULT_UNIT.other };
  }

  /**
   * The common-ingredients list for the picker (and Meal Planning). Optionally
   * filtered to names containing `query` (case-insensitive), capped for the UI.
   * @param query - Optional substring filter.
   */
  common(query?: string): CatalogEntry[] {
    const q = query?.trim().toLowerCase();
    const matches = q ? this.entries.filter((e) => e.canonicalName.includes(q)) : this.entries;
    return matches.slice(0, 100);
  }
}
