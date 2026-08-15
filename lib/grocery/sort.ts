import type { ApiGroceryItem, GroceryAisle } from "../api/types";

export type SortMode = "aisle" | "recipe" | "az";

export interface GrocerySection {
  key: string;
  title: string;
  items: ApiGroceryItem[];
}

/** Store-walk order — matches the grocery_aisle enum. */
const AISLE_ORDER: GroceryAisle[] = [
  "produce",
  "meat_seafood",
  "dairy_eggs_fridge",
  "bakery",
  "pantry",
  "herbs_spices",
  "frozen",
  "beverages",
  "household",
  "other",
];

export const AISLE_LABELS: Record<GroceryAisle, string> = {
  produce: "PRODUCE",
  meat_seafood: "MEAT & SEAFOOD",
  dairy_eggs_fridge: "DAIRY, EGGS & FRIDGE",
  bakery: "BAKERY",
  pantry: "PANTRY",
  herbs_spices: "HERBS & SPICES",
  frozen: "FROZEN",
  beverages: "BEVERAGES",
  household: "HOUSEHOLD",
  other: "OTHER",
};

const MANUAL_GROUP = "Added manually";

/** Unchecked first, then checked ("sink"); ties broken by the given comparator. */
function sink(items: ApiGroceryItem[], cmp: (a: ApiGroceryItem, b: ApiGroceryItem) => number): ApiGroceryItem[] {
  return [...items].sort((a, b) => (a.checked === b.checked ? cmp(a, b) : a.checked ? 1 : -1));
}

const byName = (a: ApiGroceryItem, b: ApiGroceryItem) => a.name.localeCompare(b.name);
const byPosition = (a: ApiGroceryItem, b: ApiGroceryItem) => a.position - b.position;

/**
 * Groups + sorts the flat list for display. `aisle` (default) buckets by store-walk
 * aisle; `recipe` buckets by source recipe (manual items last); `az` is one flat
 * A–Z list. Checked items sink within every group.
 */
export function groupAndSort(items: ApiGroceryItem[], mode: SortMode): GrocerySection[] {
  if (mode === "az") {
    return items.length ? [{ key: "az", title: "", items: sink(items, byName) }] : [];
  }

  if (mode === "recipe") {
    const groups = new Map<string, ApiGroceryItem[]>();
    for (const item of items) {
      const title = item.source_recipe_title ?? MANUAL_GROUP;
      (groups.get(title) ?? groups.set(title, []).get(title)!).push(item);
    }
    const titles = [...groups.keys()].sort((a, b) =>
      a === MANUAL_GROUP ? 1 : b === MANUAL_GROUP ? -1 : a.localeCompare(b),
    );
    return titles.map((title) => ({ key: title, title, items: sink(groups.get(title)!, byPosition) }));
  }

  return AISLE_ORDER.map((aisle) => ({
    key: aisle,
    title: AISLE_LABELS[aisle],
    items: sink(items.filter((i) => i.aisle === aisle), byPosition),
  })).filter((section) => section.items.length > 0);
}
