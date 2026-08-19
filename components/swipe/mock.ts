/**
 * Prototype mock layer for the swipe deck (Design Studio only).
 *
 * Mirrors the shape the real backend returns from GET /v1/recipes/ranked-deck
 * ({ recipe, score, breakdown }) and the POST /:id/swipe side effects, so the UI
 * is wired to representative data without a server. Swap useMockDeck for the real
 * useDeck/useSwipe hooks (docs/swipe-ui/DESIGN.md § Modules) to go live.
 */
import React from "react";

export type Direction = "like" | "dislike" | "save";
export type DislikeReason =
  | "too_expensive"
  | "too_hard"
  | "too_slow"
  | "not_nutritious"
  | "disliked_ingredient"
  | "other";
export type DifficultyBand = "beginner" | "intermediate" | "advanced";
export type MealPrepFit = "unsuitable" | "suitable" | "designed";

export type Equip = { type: string; label: string; essentiality: "required" | "recommended"; owned: boolean };
export interface Ingredient { qty: string; name: string }

export interface DeckRecipe {
  id: string;
  title: string;
  imageUrl: string;
  totalMinutes: number;
  costCents: number;
  difficulty: DifficultyBand;
  nrf: number; // higher = more nutrient-dense
  mealPrepFit: MealPrepFit;
  equipment: Equip[];
  compat: string[]; // e.g. "Vegetarian", "Nut-free" — derived diet/allergen fit vs. the user's filters
  likedNote: string; // affinity phrase for the "why" line, e.g. "Italian + chicken"
  ingredients: Ingredient[];
  steps: string[];
}

/** One ranked card, exactly as the deck endpoint returns it. */
export interface DeckCard {
  recipe: DeckRecipe;
  score: number; // 0–100
  breakdown: Record<string, number>; // signal -> 0–1
}

/* ---------- Preference model (settings surface) ---------- */
export interface Weights {
  cost: number;
  difficulty: number;
  nutrition: number;
  affinity: number;
  time: number;
  mealPrep: number;
}
export interface AllergenPref { allergen: string; severity: "severe" | "moderate" | "mild" }
export interface DietPref { diet: string; strictness: "strict" | "flexible" }
export interface Preferences {
  skillLevel: DifficultyBand;
  weeklyBudgetCents: number; // max weekly grocery spend (per-serving cost is calculated, not input)
  timeBudgetMin: number;
  weights: Weights;
  likedCuisines: string[];
  dislikedIngredients: string[];
  allergens: AllergenPref[];
  diets: DietPref[];
  ownedEquipment: string[];
  equipmentReviewed: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  skillLevel: "intermediate",
  weeklyBudgetCents: 12000,
  timeBudgetMin: 35,
  weights: { cost: 3, difficulty: 1, nutrition: 3, affinity: 2, time: 2, mealPrep: 1 },
  likedCuisines: ["Italian", "Thai", "Mexican"],
  dislikedIngredients: ["liver", "olives"],
  allergens: [{ allergen: "peanut", severity: "severe" }],
  diets: [{ diet: "Pescatarian", strictness: "flexible" }],
  ownedEquipment: ["blender", "slow_cooker"],
  equipmentReviewed: true,
};

/* ---------- Reason chips (mirror the contract's dislike reasons) ---------- */
export const REASON_CHIPS: { reason: DislikeReason; label: string; confirm: string }[] = [
  { reason: "too_expensive", label: "Too expensive", confirm: "We’ll show fewer pricey recipes." },
  { reason: "too_hard", label: "Too hard", confirm: "We’ll keep things simpler." },
  { reason: "too_slow", label: "Takes too long", confirm: "We’ll favour quicker meals." },
  { reason: "not_nutritious", label: "Not nutritious enough", confirm: "We’ll lean healthier." },
  { reason: "disliked_ingredient", label: "Don’t like an ingredient", confirm: "We’ll avoid that ingredient." },
  { reason: "other", label: "Just not feeling it", confirm: "Got it." },
];

const IMG = (seed: string) => `https://picsum.photos/seed/${seed}/900/1200`;

/* ---------- The mock candidate pool (ranked best-first, like the deck endpoint) ---------- */
const POOL: DeckCard[] = [
  {
    recipe: {
      id: "r1", title: "Chicken Piccata", imageUrl: IMG("piccata"),
      totalMinutes: 25, costCents: 350, difficulty: "intermediate", nrf: 45, mealPrepFit: "suitable",
      equipment: [], compat: ["Nut-free"], likedNote: "Italian + chicken",
      ingredients: [{ qty: "2", name: "Chicken breasts" }, { qty: "2 tbsp", name: "Capers" }, { qty: "1", name: "Lemon" }, { qty: "3 tbsp", name: "Butter" }, { qty: "2 tbsp", name: "Parsley" }, { qty: "½ cup", name: "Flour" }],
      steps: ["Dredge and sear the chicken.", "Build the lemon-caper pan sauce.", "Simmer and plate."],
    },
    score: 82, breakdown: { affinity: 0.83, cost: 1.0, time: 1.0, nutrition: 0.44, difficulty: 1.0 },
  },
  {
    recipe: {
      id: "r2", title: "Sheet-Pan Salmon & Greens", imageUrl: IMG("salmon"),
      totalMinutes: 30, costCents: 480, difficulty: "beginner", nrf: 78, mealPrepFit: "designed",
      equipment: [], compat: ["Pescatarian", "Nut-free"], likedNote: "salmon you love",
      ingredients: [{ qty: "2", name: "Salmon fillets" }, { qty: "1 bunch", name: "Broccolini" }, { qty: "2 tbsp", name: "Olive oil" }, { qty: "3 cloves", name: "Garlic" }, { qty: "1", name: "Lemon" }],
      steps: ["Toss greens with oil and garlic.", "Roast with the salmon 15 min.", "Finish with lemon."],
    },
    score: 79, breakdown: { nutrition: 0.79, meal_prep: 1.0, time: 0.83, cost: 0.55, difficulty: 0.85 },
  },
  {
    recipe: {
      id: "r3", title: "Thai Green Curry Bowls", imageUrl: IMG("curry"),
      totalMinutes: 35, costCents: 420, difficulty: "intermediate", nrf: 60, mealPrepFit: "designed",
      equipment: [{ type: "blender", label: "Blender", essentiality: "recommended", owned: true }],
      compat: ["Vegetarian option"], likedNote: "Thai flavours",
      ingredients: [{ qty: "3 tbsp", name: "Green curry paste" }, { qty: "1 can", name: "Coconut milk" }, { qty: "14 oz", name: "Tofu" }, { qty: "2 cups", name: "Jasmine rice" }, { qty: "¼ cup", name: "Thai basil" }],
      steps: ["Blitz the aromatics.", "Simmer the curry.", "Portion over rice."],
    },
    score: 76, breakdown: { affinity: 0.83, meal_prep: 1.0, nutrition: 0.61, time: 0.71, cost: 0.71 },
  },
  {
    recipe: {
      id: "r4", title: "Slow-Cooker Beef Chili", imageUrl: IMG("chili"),
      totalMinutes: 380, costCents: 300, difficulty: "beginner", nrf: 52, mealPrepFit: "designed",
      equipment: [{ type: "slow_cooker", label: "Slow cooker", essentiality: "required", owned: true }],
      compat: ["Gluten-free", "Nut-free"], likedNote: "batch-friendly comfort",
      ingredients: [{ qty: "1 lb", name: "Ground beef" }, { qty: "2 cans", name: "Kidney beans" }, { qty: "28 oz", name: "Tomatoes" }, { qty: "2 tbsp", name: "Chili powder" }, { qty: "1", name: "Onion" }],
      steps: ["Brown the beef.", "Load the slow cooker.", "Cook low 6 hours."],
    },
    score: 74, breakdown: { cost: 1.0, meal_prep: 1.0, nutrition: 0.48, difficulty: 0.85, time: 0.2 },
  },
  {
    recipe: {
      id: "r5", title: "Weeknight Margherita Flatbread", imageUrl: IMG("flatbread"),
      totalMinutes: 20, costCents: 260, difficulty: "beginner", nrf: 40, mealPrepFit: "unsuitable",
      equipment: [], compat: ["Vegetarian", "Nut-free"], likedNote: "Italian",
      ingredients: [{ qty: "2", name: "Flatbreads" }, { qty: "8 oz", name: "Fresh mozzarella" }, { qty: "1", name: "Tomato" }, { qty: "¼ cup", name: "Basil" }, { qty: "1 tbsp", name: "Olive oil" }],
      steps: ["Top the flatbread.", "Bake 10 min.", "Finish with basil."],
    },
    score: 71, breakdown: { affinity: 0.67, cost: 1.0, time: 1.0, difficulty: 0.85, nutrition: 0.41 },
  },
  {
    recipe: {
      id: "r6", title: "Air-Fryer Crispy Tofu Bowls", imageUrl: IMG("tofu"),
      totalMinutes: 28, costCents: 310, difficulty: "beginner", nrf: 66, mealPrepFit: "suitable",
      equipment: [{ type: "air_fryer", label: "Air fryer", essentiality: "recommended", owned: false }],
      compat: ["Vegan", "Nut-free"], likedNote: "crispy and light",
      ingredients: [{ qty: "14 oz", name: "Firm tofu" }, { qty: "¼ cup", name: "Cornstarch" }, { qty: "3 tbsp", name: "Soy sauce" }, { qty: "2 cups", name: "Brown rice" }, { qty: "2 cups", name: "Slaw" }],
      steps: ["Coat and air-fry the tofu.", "Warm the rice.", "Assemble with slaw."],
    },
    score: 68, breakdown: { nutrition: 0.67, cost: 1.0, time: 0.9, meal_prep: 0.6, difficulty: 0.85 },
  },
  {
    recipe: {
      id: "r7", title: "Mexican Street-Corn Quesadillas", imageUrl: IMG("quesadilla"),
      totalMinutes: 22, costCents: 280, difficulty: "beginner", nrf: 43, mealPrepFit: "suitable",
      equipment: [], compat: ["Vegetarian"], likedNote: "Mexican",
      ingredients: [{ qty: "4", name: "Tortillas" }, { qty: "1½ cups", name: "Corn" }, { qty: "½ cup", name: "Cotija" }, { qty: "¼ cup", name: "Chipotle mayo" }, { qty: "2 tbsp", name: "Cilantro" }],
      steps: ["Char the corn.", "Fill and griddle.", "Slice and serve."],
    },
    score: 65, breakdown: { affinity: 0.83, cost: 1.0, time: 1.0, nutrition: 0.42, difficulty: 0.85 },
  },
  {
    recipe: {
      id: "r8", title: "Lemon-Herb Grain Salad", imageUrl: IMG("grainsalad"),
      totalMinutes: 18, costCents: 240, difficulty: "beginner", nrf: 72, mealPrepFit: "suitable",
      equipment: [], compat: ["Vegan", "Nut-free"], likedNote: "fresh and fast",
      ingredients: [{ qty: "1½ cups", name: "Farro" }, { qty: "1", name: "Cucumber" }, { qty: "½ cup", name: "Herbs" }, { qty: "½ cup", name: "Feta" }, { qty: "3 tbsp", name: "Lemon vinaigrette" }],
      steps: ["Cook the farro.", "Chop and toss.", "Dress and chill."],
    },
    score: 63, breakdown: { nutrition: 0.72, cost: 1.0, time: 1.0, difficulty: 0.85, meal_prep: 0.6 },
  },
];

/** Ingredient list the "disliked ingredient" picker offers (reason_detail source). */
export const COMMON_INGREDIENTS = [
  "Cilantro", "Mushrooms", "Olives", "Blue cheese", "Anchovies", "Bell peppers",
  "Coconut", "Tofu", "Eggplant", "Liver", "Capers", "Raisins",
];

/* ---------- The "why this is ranked for you" line, from the breakdown ---------- */
const WHY: Record<string, (r: DeckRecipe) => string> = {
  affinity: (r) => `${r.likedNote} you love`,
  cost: () => "under your budget",
  time: (r) => `${r.totalMinutes} min`,
  nutrition: () => "nutritious",
  difficulty: () => "matches your skill",
  meal_prep: () => "great for meal prep",
};

export function buildWhyLine(card: DeckCard): string {
  const phrases = Object.entries(card.breakdown)
    .filter(([, v]) => v >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sig]) => WHY[sig]?.(card.recipe))
    .filter(Boolean) as string[];
  return phrases.join(", ");
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const formatTime = (min: number) => (min >= 60 ? `${Math.round(min / 60)} hr` : `${min} min`);
export const difficultyLabel = (d: DifficultyBand) => cap(d);

/* ---------- The deck controller (mock useDeck + useSwipe) ---------- */
export type DeckStatus = "loading" | "ready" | "empty" | "error";
const BATCH = 5;
// Demo threshold, reachable within the 8-card pool; DESIGN.md F-04/Q-09 default is 10 in production (fa-3).
const PLAN_NUDGE_AT = 4;

export type SwipeRecord = { card: DeckCard; direction: Direction };

export interface DeckController {
  status: DeckStatus;
  cards: DeckCard[]; // in-hand, index 0 = top; never reshuffled once dealt
  likeCount: number;
  showNudge: boolean;
  lastSwipe: SwipeRecord | null;
  failedSave: DeckCard | null; // a card whose save rolled back (front of deck)
  swipe: (direction: Direction, reason?: DislikeReason, detail?: string) => void;
  undo: () => void;
  retry: () => void;
  dismissNudge: () => void;
}

/**
 * initial: 'deck' | 'empty' | 'error' seeds the starting state so reviewers can
 * inspect each. failSaves: true makes every optimistic POST roll back (to demo
 * the never-lose-a-swipe recovery).
 */
export function useMockDeck(initial: "deck" | "empty" | "error", failSaves: boolean): DeckController {
  const [status, setStatus] = React.useState<DeckStatus>("loading");
  const [cards, setCards] = React.useState<DeckCard[]>([]);
  const [likeCount, setLikeCount] = React.useState(0);
  const [showNudge, setShowNudge] = React.useState(false);
  const [lastSwipe, setLastSwipe] = React.useState<SwipeRecord | null>(null);
  const [failedSave, setFailedSave] = React.useState<DeckCard | null>(null);
  const poolRef = React.useRef<DeckCard[]>([]);
  const nudgedRef = React.useRef(false);

  // Initial deal — simulate the first ranked-deck fetch latency.
  React.useEffect(() => {
    if (initial === "error") {
      const t = setTimeout(() => setStatus("error"), 400);
      return () => clearTimeout(t);
    }
    if (initial === "empty") {
      poolRef.current = [];
      const t = setTimeout(() => setStatus("empty"), 400);
      return () => clearTimeout(t);
    }
    poolRef.current = [...POOL];
    const t = setTimeout(() => {
      setCards(poolRef.current.splice(0, BATCH));
      setStatus("ready");
    }, 500);
    return () => clearTimeout(t);
  }, [initial]);

  // Prefetch the next batch when 1–2 cards remain (append to the tail; in-hand order preserved).
  React.useEffect(() => {
    if (status !== "ready") return;
    if (cards.length > 2) return;
    if (poolRef.current.length === 0) {
      if (cards.length === 0) setStatus("empty");
      return;
    }
    const next = poolRef.current.splice(0, BATCH);
    setCards((c) => [...c, ...next]);
  }, [cards.length, status]);

  const swipe = React.useCallback(
    (direction: Direction, _reason?: DislikeReason, _detail?: string) => {
      setCards((current) => {
        const [top, ...rest] = current;
        if (!top) return current;
        setLastSwipe({ card: top, direction });
        setFailedSave(null);
        if (direction === "like" || direction === "save") {
          setLikeCount((n) => {
            const next = n + 1;
            if (next >= PLAN_NUDGE_AT && !nudgedRef.current) {
              nudgedRef.current = true;
              setShowNudge(true);
            }
            return next;
          });
        }
        // Optimistic POST (fire-and-forget). On failure, roll the card back to the front.
        setTimeout(() => {
          if (failSaves) {
            setCards((c) => [top, ...c]);
            setFailedSave(top);
            if (direction === "like" || direction === "save") setLikeCount((n) => Math.max(0, n - 1));
          }
        }, 450);
        return rest;
      });
    },
    [failSaves],
  );

  const undo = React.useCallback(() => {
    setLastSwipe((last) => {
      if (!last) return null;
      setCards((c) => [last.card, ...c]);
      if (last.direction === "like" || last.direction === "save") setLikeCount((n) => Math.max(0, n - 1));
      if (status === "empty") setStatus("ready");
      return null;
    });
  }, [status]);

  const retry = React.useCallback(() => {
    setStatus("loading");
    poolRef.current = [...POOL];
    setTimeout(() => {
      setCards(poolRef.current.splice(0, BATCH));
      setStatus("ready");
    }, 500);
  }, []);

  const dismissNudge = React.useCallback(() => setShowNudge(false), []);

  return { status, cards, likeCount, showNudge, lastSwipe, failedSave, swipe, undo, retry, dismissNudge };
}
