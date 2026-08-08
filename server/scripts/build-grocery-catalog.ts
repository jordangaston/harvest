import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mapIngredientIcon } from '../src/parse/icons.js';
import {
  CATEGORY_TO_AISLE,
  AISLE_DEFAULT_UNIT,
  CATALOG_SUPPLEMENT,
  type CatalogEntry,
} from '../src/grocery/aisle-map.js';
import type { GroceryAisle } from '../src/db/schema/enums.js';

/**
 * Builds `server/seed/grocery-catalog.json` from USDA Foundation Foods (offline,
 * run once, output committed). Each entry is `{ canonicalName, aisle, defaultUnit,
 * iconKey }` — the contract Meal Planning consumes. The raw USDA file is NOT
 * committed; re-run this after the icon set grows so `iconKey`s pick up new icons.
 */
const SOURCE =
  process.env.USDA_JSON ??
  join(homedir(), 'Desktop/Business/Harvest/FoodData_Central_foundation_food_json_2026-04-30.json');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'grocery-catalog.json');

/** USDA descriptions read "Category, specifier, prep" — the first comma-segment,
 * lowercased, is a good-enough canonical name. Hand-fix egregious rows in the JSON. */
function canonicalName(description: string): string {
  return description.split(',')[0]!.trim().toLowerCase();
}

function build(): CatalogEntry[] {
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
    FoundationFoods: Array<{ description: string; foodCategory?: { description?: string } | string }>;
  };
  const byName = new Map<string, CatalogEntry>();

  for (const food of raw.FoundationFoods) {
    if (!food?.description) continue;
    const name = canonicalName(food.description);
    if (!name || byName.has(name)) continue;
    const category =
      typeof food.foodCategory === 'string' ? food.foodCategory : (food.foodCategory?.description ?? '');
    const aisle: GroceryAisle = CATEGORY_TO_AISLE[category] ?? 'other';
    byName.set(name, { canonicalName: name, aisle, defaultUnit: AISLE_DEFAULT_UNIT[aisle], iconKey: mapIngredientIcon(name) });
  }

  for (const s of CATALOG_SUPPLEMENT) {
    if (byName.has(s.canonicalName)) continue;
    byName.set(s.canonicalName, {
      canonicalName: s.canonicalName,
      aisle: s.aisle,
      defaultUnit: AISLE_DEFAULT_UNIT[s.aisle],
      iconKey: s.iconKey,
    });
  }

  return [...byName.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const entries = build();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(entries, null, 2) + '\n');
  process.stdout.write(`wrote ${entries.length} catalog entries → ${OUT}\n`);
}
