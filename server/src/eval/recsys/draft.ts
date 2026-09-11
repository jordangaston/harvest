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
        'recipe A. A good recommendation is a 2 or a 3; both 0 and 1 are bad recs. Weigh dish form, cuisine, ' +
        `main ingredients, and role in a meal — a shared condiment or one incidental ingredient is NOT similarity. ` +
        `Scale: ${REL_SCALE}. ` +
        'Example: "Grilled Baby Potatoes with Dijon & Thyme" vs "Mustard-Crème Fraîche Sauce" = 1 (they share ' +
        'mustard, but a sauce is not a sensible rec for a potato side). ' +
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
