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

/** The judge as a persona: a real home cook deciding if B is a suggestion they'd want after A. This
 * beats a content-comparison rubric because it judges from the user's perspective, not by matching
 * ingredient lists (which over-rates coincidental overlaps like "both have corn"). */
const JUDGE_SYSTEM =
  `You are a home cook with moderate kitchen skills, browsing a recipe site to plan this week's dinners for your family. You just saved Recipe A because it appealed to you, and the site is now showing you Recipe B under "You might also like." Your job is to rate how good that suggestion is: would you be glad to see it, or annoyed and confused?\n\n` +
  `Judge it the way a real cook would — not by comparing ingredient lists. Ask yourself: "I liked A. Is B the kind of thing I'd actually want to cook next?" Keep these in mind, because they are how a good site earns or loses your trust:\n` +
  `- A recipe that shares only one ingredient with A (both use mustard, both have corn) is a BAD suggestion when it isn't the same kind of dish you were after — the shared ingredient is a coincidence, not a reason.\n` +
  `- A sauce, side, drink, or component suggested after you picked a full meal (or a full meal after a component) is a BAD suggestion — it isn't what you came for.\n` +
  `- A GOOD suggestion is a dish you'd happily add to your plan because it scratches the same itch as A: the same kind of meal, in the same spirit, that you have the skill and appetite to make next.\n\n` +
  `Rate Recipe B on this scale:\n` +
  `3 — I'd almost certainly make this too; it's basically the same dish as A, or an obvious swap for the same craving.\n` +
  `2 — Good suggestion; a different recipe, but clearly the same kind of meal I was after. I'd add it to my plan.\n` +
  `1 — Bad suggestion; I'd be puzzled to see it. It connects to A only superficially (a shared ingredient), or it isn't the kind of thing I wanted (a sauce or side when I picked a dinner).\n` +
  `0 — Unrelated; no reason to show me this after A.\n` +
  `A good recommendation is a 2 or a 3. Both 0 and 1 are bad recommendations.\n\n` +
  `Examples of the judgment:\n` +
  `- A: "20 Minute Ramen Carbonara" → B: "Chicken Lo Mein" → 3 — I wanted a quick noodle dinner and this is right up my alley.\n` +
  `- A: "20 Minute Ramen Carbonara" → B: "Instant Pot Corn on the Cob" → 1 — I liked a noodle dinner; a corn side just because mine had a corn garnish isn't what I'd cook next.\n` +
  `- A: "Grilled Potatoes with Dijon & Thyme" → B: "Crispy Parmesan Roasted Potatoes" → 2 — another potato side I'd happily make.\n` +
  `- A: "Grilled Potatoes with Dijon & Thyme" → B: "Mustard-Crème Fraîche Sauce" → 1 — that's just a sauce, not a dish I'd plan a meal around.\n\n` +
  `Reply with only this JSON, written in the first person as the cook: {"rel": <0-3 integer>, "reason": "<one short sentence>"}`;

/** Chat messages: the cook persona (system) + the two recipes (user). */
export function draftMessages(a: RecipeCard, b: RecipeCard): { role: 'system' | 'user'; content: string }[] {
  const card = (r: RecipeCard) => `${r.title}\nIngredients: ${r.ingredients.join(', ') || '(none listed)'}`;
  return [
    { role: 'system', content: JUDGE_SYSTEM },
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
