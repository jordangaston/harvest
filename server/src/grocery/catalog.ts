import { mapIngredientIcon } from '../parse/icons.js';
import { AISLE_DEFAULT_UNIT, type CatalogEntry } from './aisle-map.js';
import type { GroceryAisle } from '../schema.js';
import catalogEntries from '../../seed/grocery-catalog.json';

// DECISION (serverless port): the 18.7 KB catalog is static reference data, not
// per-user rows — so it's imported directly and inlined into the bundle by the
// builder. A runtime `readFileSync` of the seed path does NOT survive bundling
// (the file isn't traced into the Vercel function), so the import is the reliable
// way to ship it. Only per-user `grocery_items` live in Turso; the catalog is
// never seeded into the DB.

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

  /** Load from the committed, bundled seed catalog. */
  static create(): GroceryCatalog {
    return new GroceryCatalog(catalogEntries as unknown as CatalogEntry[]);
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
