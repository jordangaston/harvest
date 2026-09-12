/** LLM draft labels for Tier 2: given two recipe cards, ask a model to rate their similarity 0–3.
 * The draft is a starting point the human confirms or flips — never the ground truth. Prompt build
 * + response parse are pure (testable); the network call lives in the script. */

export interface RecipeCard {
  id: string;
  title: string;
  ingredients: string[];
}

/** Graded relevance for the "you might also like" judgement — anchored on rec QUALITY: a good rec
 * is a 2 or a 3; both 0 and 1 are bad recs (1 just has a superficial thread). */
export const REL_SCALE =
  '0 = unrelated (no meaningful connection); ' +
  '1 = BAD rec — shares only something superficial (a condiment, one minor ingredient, a loose theme), ' +
  'so a user who liked A would be frustrated or confused to see B recommended; ' +
  '2 = GOOD rec — a sensible "you might also like" (dish form aligns, plus cuisine or a main ingredient); ' +
  '3 = very similar — essentially the same dish (form + cuisine + overlapping main ingredients)';

export interface Draft {
  rel: number;
  reason: string;
}

/** Chat messages asking for a 0–3 similarity verdict as JSON. */
export function draftMessages(a: RecipeCard, b: RecipeCard): { role: 'system' | 'user'; content: string }[] {
  const card = (r: RecipeCard) => `${r.title}\nIngredients: ${r.ingredients.join(', ') || '(none listed)'}`;
  return [
    {
      role: 'system',
      content:
        "You judge whether recipe B is a good 'you might also like' recommendation for someone who liked " +
        'recipe A. Judge the DISH AS A WHOLE — its form (pasta, soup, taco, cocktail…), its main ' +
        'ingredients, and its cuisine — NOT whether the two happen to share one ingredient. A person who ' +
        'liked A should want to cook B next.\n' +
        'Rate LOW (0 or 1) when the only link is superficial, even if an ingredient matches:\n' +
        '• single-ingredient / garnish overlap — e.g. both contain corn, or both contain mustard — but the ' +
        'dishes are otherwise different. This is the most common bad rec; do not be fooled by a shared ingredient.\n' +
        "• role mismatch — B is a sauce, side, condiment, drink, or component but A is a full dish (or vice versa).\n" +
        'Rate HIGH (2 or 3) only when B shares A\'s overall character: same/related form AND overlapping mains ' +
        'or cuisine. A good recommendation is a 2 or a 3; both 0 and 1 are bad recs.\n' +
        `Scale: ${REL_SCALE}.\n` +
        'Examples: "Ramen Carbonara" (a noodle dish) → "Soba Noodles" or "Chicken Lo Mein" = 2-3 (both noodle ' +
        'dishes); → "Corn on the Cob" or "Creamed Corn Chicken" = 0-1 (shares only the corn garnish, a totally ' +
        'different dish). "Grilled Potatoes with Dijon" → "Mustard-Crème Fraîche Sauce" = 1 (shares only mustard; ' +
        'a sauce is not a dish to recommend). ' +
        'Return JSON {"rel": <0-3 integer>, "reason": "<one short sentence>"}.',
    },
    { role: 'user', content: `Recipe A:\n${card(a)}\n\nRecipe B:\n${card(b)}` },
  ];
}

/** Parse the model's JSON content into a clamped integer 0–3 draft; degrades to rel 0 on bad output. */
export function parseDraft(content: string | undefined): Draft {
  try {
    const parsed = JSON.parse(content ?? '{}') as { rel?: unknown; reason?: unknown };
    const rel = Math.max(0, Math.min(3, Math.round(Number(parsed.rel))));
    return { rel: Number.isFinite(rel) ? rel : 0, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch {
    return { rel: 0, reason: '' };
  }
}
