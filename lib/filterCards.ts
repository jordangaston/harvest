import type { RecipeCard } from "./api/types";

/** The filters the add-recipe sheet applies to a library, all client-side. */
export interface CardFilters {
  /** Case-insensitive title substring. */
  search?: string;
  /** Ingredient terms; a card matches only if ALL are present (substring, pantry AND). */
  ingredients?: string[];
  /** Total-time bucket ceiling in minutes (15/30/60); null total_minutes is excluded when set. */
  maxMinutes?: number;
  /** Restrict to cards in this cookbook (undefined = the whole library / "All recipes"). */
  cookbookId?: string;
}

/**
 * Filters recipe cards by search text, ingredients (AND), total-time bucket, and
 * cookbook. Pure — the single place the add sheet's filtering lives.
 * @param cards - The library cards (expanded with ingredient_names/cookbook_ids).
 * @param f - The active filters; an empty filter set returns the cards unchanged.
 */
export function filterCards(cards: RecipeCard[], f: CardFilters): RecipeCard[] {
  const search = f.search?.trim().toLowerCase();
  const terms = (f.ingredients ?? []).map((t) => t.toLowerCase());
  return cards.filter((c) => {
    if (f.cookbookId && !(c.cookbook_ids ?? []).includes(f.cookbookId)) return false;
    if (search && !c.title.toLowerCase().includes(search)) return false;
    if (f.maxMinutes != null) {
      if (c.total_minutes == null || c.total_minutes > f.maxMinutes) return false;
    }
    if (terms.length > 0) {
      const names = (c.ingredient_names ?? []).map((n) => n.toLowerCase());
      if (!terms.every((t) => names.some((n) => n.includes(t)))) return false;
    }
    return true;
  });
}
