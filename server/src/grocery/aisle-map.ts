import type { GroceryAisle } from '../db/schema/enums.js';

/**
 * USDA Foundation Foods `foodCategory` → our store-walk `grocery_aisle`. The catalog
 * build (`scripts/build-grocery-catalog.ts`) is the only caller; anything unmapped
 * falls back to `other`.
 */
export const CATEGORY_TO_AISLE: Record<string, GroceryAisle> = {
  'Vegetables and Vegetable Products': 'produce',
  'Fruits and Fruit Juices': 'produce',
  'Dairy and Egg Products': 'dairy_eggs_fridge',
  'Cereal Grains and Pasta': 'pantry',
  'Legumes and Legume Products': 'pantry',
  'Finfish and Shellfish Products': 'meat_seafood',
  'Nut and Seed Products': 'pantry',
  'Beef Products': 'meat_seafood',
  'Poultry Products': 'meat_seafood',
  'Fats and Oils': 'pantry',
  'Pork Products': 'meat_seafood',
  'Sausages and Luncheon Meats': 'meat_seafood',
  'Lamb, Veal, and Game Products': 'meat_seafood',
  'Restaurant Foods': 'other',
  Beverages: 'beverages',
  'Spices and Herbs': 'herbs_spices',
  'Soups, Sauces, and Gravies': 'pantry',
  Sweets: 'pantry',
  'Baked Products': 'bakery',
};

/**
 * A sensible default buying unit per aisle — the prefill when a manually-typed item
 * gives no unit. Coarse by design (an overridable starting point, not a fact).
 */
export const AISLE_DEFAULT_UNIT: Record<GroceryAisle, string> = {
  produce: 'count',
  meat_seafood: 'pound',
  dairy_eggs_fridge: 'count',
  bakery: 'count',
  pantry: 'count',
  herbs_spices: 'teaspoon',
  frozen: 'package',
  beverages: 'count',
  household: 'count',
  other: 'count',
};

/** One catalog entry — the contract Meal Planning consumes from `GET /v1/ingredients/common`. */
export interface CatalogEntry {
  canonicalName: string;
  aisle: GroceryAisle;
  defaultUnit: string;
  iconKey: string;
}

/**
 * Hand-added common groceries USDA Foundation Foods barely covers (bakery, drinks,
 * frozen). Keeps the picker useful and gives these icon keys a real aisle. `iconKey`
 * must match a key the icon set actually ships (see `parse/icons.ts` / the app ICON map).
 */
export const CATALOG_SUPPLEMENT: Array<{ canonicalName: string; aisle: GroceryAisle; iconKey: string }> = [
  { canonicalName: 'bread', aisle: 'bakery', iconKey: 'bread' },
  { canonicalName: 'bagel', aisle: 'bakery', iconKey: 'bagel' },
  { canonicalName: 'tortilla', aisle: 'bakery', iconKey: 'tortilla' },
  { canonicalName: 'pita', aisle: 'bakery', iconKey: 'pita' },
  { canonicalName: 'croissant', aisle: 'bakery', iconKey: 'croissant' },
  { canonicalName: 'buns', aisle: 'bakery', iconKey: 'bun' },
  { canonicalName: 'coffee', aisle: 'beverages', iconKey: 'coffee' },
  { canonicalName: 'tea', aisle: 'beverages', iconKey: 'tea' },
  { canonicalName: 'orange juice', aisle: 'beverages', iconKey: 'orangeJuice' },
  { canonicalName: 'beer', aisle: 'beverages', iconKey: 'beer' },
  { canonicalName: 'white wine', aisle: 'beverages', iconKey: 'whiteWine' },
  { canonicalName: 'ice cream', aisle: 'frozen', iconKey: 'iceCream' },
];
