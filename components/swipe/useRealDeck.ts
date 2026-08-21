import React from "react";
import { getDeck, recordSwipe, unswipe, type ApiDeckCard } from "../../lib/api/swipe";
import type { DeckCard, DeckController, DeckRecipe, DeckStatus, Direction, DislikeReason, SwipeRecord } from "./mock";

const LIMIT = 10;

const humanize = (type: string) => type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The user's filters, so the card's `compat` chips read against them (WI-3 follow-up). */
interface Filters {
  owned: Set<string>;
  allergens: Set<string>; // server allergen enums the user avoids
  diets: Set<string>; // diet ids the user follows
}

/** Compat chips: "X-free" for each of the user's allergens the recipe avoids, plus the user's diets
 * the recipe is compatible with. Both come from the deck card (recipe allergens + compatible diets). */
function buildCompat(recipeAllergens: string[], recipeDiets: string[], f: Filters): string[] {
  const chips: string[] = [];
  for (const a of f.allergens) if (!recipeAllergens.includes(a)) chips.push(`${humanize(a)}-free`);
  for (const d of f.diets) if (recipeDiets.includes(d)) chips.push(d);
  return chips;
}

/**
 * Maps the enriched deck-card DTO (WI-5) → the `DeckCard` the SwipeCard renders. Core + accent
 * badges, `compat`, and the "why" breakdown come straight from the card. Ingredients/steps aren't
 * on the deck card — the DetailSheet hydrates them lazily via `GET /v1/recipes/:id?fields=…`.
 */
function toDeckCard(api: ApiDeckCard, f: Filters): DeckCard {
  const r = api.recipe;
  const recipe: DeckRecipe = {
    id: r.id,
    title: r.title,
    imageUrl: r.image_url ?? "",
    totalMinutes: r.total_minutes ?? 0,
    costCents: r.cost_per_serving_cents ?? 0,
    difficulty: r.difficulty_band ?? "beginner",
    nrf: r.nrf_score ?? 0,
    mealPrepFit: r.meal_prep_fit ?? "suitable",
    equipment: (r.equipment ?? []).map((e) => ({
      type: e.equipment,
      label: humanize(e.equipment),
      essentiality: e.essentiality === "required" ? "required" : "recommended",
      owned: f.owned.has(e.equipment),
    })),
    compat: buildCompat(r.allergens ?? [], r.diets ?? [], f),
    macros: r.nutrition ? { calories: r.nutrition.calories, protein: r.nutrition.protein_g, carbs: r.nutrition.carbs_g, fat: r.nutrition.fat_g } : null,
    likedNote: "",
    ingredients: [],
    steps: [],
  };
  return { recipe, score: api.score, breakdown: api.breakdown };
}

/**
 * The live swipe-deck controller, backed by the real endpoints — the drop-in for the studio's
 * `useMockDeck`. Fetches a ranked batch, appends re-ranked batches when the hand runs low (the
 * server excludes swiped recipes), swipes optimistically with rollback, and un-swipes on undo.
 */
export function useRealDeck(opts?: {
  ownedEquipment?: string[];
  allergens?: string[];
  diets?: string[];
  /** Discover refills the hand as it runs low; the onboarding warm-up sets this false to
   * cap at one batch, going `empty` (→ done) once the last card is swiped. */
  refill?: boolean;
  /** Meal-type filter: recipe_categories values (any facet). Changing it resets the deck. */
  categories?: string[];
}): DeckController {
  const refill = opts?.refill !== false;
  const categoriesKey = (opts?.categories ?? []).join(",");
  const categoriesRef = React.useRef<string[] | undefined>(opts?.categories);
  categoriesRef.current = opts?.categories;
  const filtersRef = React.useRef<Filters>({ owned: new Set(), allergens: new Set(), diets: new Set() });
  filtersRef.current = {
    owned: new Set(opts?.ownedEquipment ?? []),
    allergens: new Set(opts?.allergens ?? []),
    diets: new Set(opts?.diets ?? []),
  };

  const [status, setStatus] = React.useState<DeckStatus>("loading");
  const [cards, setCards] = React.useState<DeckCard[]>([]);
  const [likeCount, setLikeCount] = React.useState(0);
  const [lastSwipe, setLastSwipe] = React.useState<SwipeRecord | null>(null);
  const [failedSave, setFailedSave] = React.useState<DeckCard | null>(null);
  const inflight = React.useRef(false);

  const fetchBatch = React.useCallback(async (mode: "initial" | "more") => {
    if (inflight.current) return;
    inflight.current = true;
    if (mode === "initial") setStatus("loading");
    try {
      const batch = (await getDeck(LIMIT, categoriesRef.current)).map((c) => toDeckCard(c, filtersRef.current));
      setCards((prev) => {
        const have = new Set(prev.map((c) => c.recipe.id));
        const next = mode === "initial" ? batch : [...prev, ...batch.filter((c) => !have.has(c.recipe.id))];
        setStatus(next.length ? "ready" : "empty");
        return next;
      });
    } catch {
      if (mode === "initial") setStatus("error");
    } finally {
      inflight.current = false;
    }
  }, []);

  React.useEffect(() => { void fetchBatch("initial"); }, [fetchBatch, categoriesKey]);

  // Discover appends a re-ranked batch when the hand runs low (order preserved); the
  // bounded warm-up instead goes `empty` once its single batch is exhausted.
  React.useEffect(() => {
    if (status !== "ready") return;
    if (refill) { if (cards.length <= 2) void fetchBatch("more"); }
    else if (cards.length === 0) setStatus("empty");
  }, [cards.length, status, refill, fetchBatch]);

  const swipe = React.useCallback((direction: Direction, reason?: DislikeReason, detail?: string) => {
    setCards((current) => {
      const [top, ...rest] = current;
      if (!top) return current;
      setLastSwipe({ card: top, direction });
      setFailedSave(null);
      if (direction === "like" || direction === "save") setLikeCount((n) => n + 1);
      // Optimistic POST — roll the card back to the front on failure.
      recordSwipe(top.recipe.id, { direction, reason, reason_detail: detail }).catch(() => {
        setCards((c) => [top, ...c]);
        setFailedSave(top);
        if (direction === "like" || direction === "save") setLikeCount((n) => Math.max(0, n - 1));
      });
      return rest;
    });
  }, []);

  const undo = React.useCallback(() => {
    setLastSwipe((last) => {
      if (!last) return null;
      void unswipe(last.card.recipe.id).catch(() => {});
      setCards((c) => [last.card, ...c]);
      if (last.direction === "like" || last.direction === "save") setLikeCount((n) => Math.max(0, n - 1));
      setStatus((s) => (s === "empty" ? "ready" : s));
      return null;
    });
  }, []);

  const retry = React.useCallback(() => { void fetchBatch("initial"); }, [fetchBatch]);

  return { status, cards, likeCount, lastSwipe, failedSave, swipe, undo, retry };
}
