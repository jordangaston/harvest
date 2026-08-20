import React from "react";
import { getDeck, recordSwipe, unswipe, type ApiDeckCard } from "../../lib/api/swipe";
import type { DeckCard, DeckController, DeckRecipe, DeckStatus, Direction, DislikeReason, SwipeRecord } from "./mock";

const LIMIT = 5;

const humanize = (type: string) => type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Maps the enriched deck-card DTO (WI-5) → the `DeckCard` the SwipeCard renders. The core +
 * accent badges and the "why" breakdown come straight from the card. Ingredients/steps aren't on
 * the deck card — the DetailSheet hydrates them via a `GET /v1/recipes/:id` fetch (follow-up); and
 * `compat` needs the recipe's diet/allergen fit, also absent from the card (follow-up).
 */
function toDeckCard(api: ApiDeckCard, owned: Set<string>): DeckCard {
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
      owned: owned.has(e.equipment),
    })),
    compat: [],
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
export function useRealDeck(opts?: { ownedEquipment?: string[] }): DeckController {
  const ownedRef = React.useRef<Set<string>>(new Set());
  ownedRef.current = new Set(opts?.ownedEquipment ?? []);

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
      const batch = (await getDeck(LIMIT)).map((c) => toDeckCard(c, ownedRef.current));
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

  React.useEffect(() => { void fetchBatch("initial"); }, [fetchBatch]);

  // Append a re-ranked batch when the in-hand deck runs low (in-hand order is preserved).
  React.useEffect(() => {
    if (status === "ready" && cards.length <= 2) void fetchBatch("more");
  }, [cards.length, status, fetchBatch]);

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
