/** LLM draft labels for Tier 2: given two recipe cards, ask a model to rate their similarity 0–3.
 * The draft is a starting point the human confirms or flips — never the ground truth. Prompt build
 * + response parse are pure (testable); the network call lives in the script. */

export interface RecipeCard {
  id: string;
  title: string;
  ingredients: string[];
}

/** Graded relevance for the "you might also like" judgement. */
export const REL_SCALE = '0 = unrelated, 1 = loosely related, 2 = similar, 3 = very similar / near-duplicate';

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
        "You judge how similar two recipes are for a 'you might also like' recommender. Consider cuisine, " +
        `dish form, main ingredients, and role in a meal. Rate similarity: ${REL_SCALE}. ` +
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
