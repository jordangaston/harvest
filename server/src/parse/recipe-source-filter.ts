/**
 * Cheap pre-filter for a seed URL list (e.g. recipes.json): drops pages that clearly aren't a
 * single recipe — roundups ("30 Popular Mexican Recipes"), guides, about/pantry pages, tutorials —
 * so we don't waste a fetch on them. The definitive gate is still `hasRecipe` (Recipe JSON-LD)
 * after the fetch; this only trims the obvious non-recipes up front.
 */
const SKIP_URL = [
  /\/category\//,
  /\/web-stories\//,
  /\/(shop|lifestyle|press|barn|pantry|kitchen|videos|community|contact|register|log-in|subscribe|essentials|book-tour)\b/,
  /\/cookbook/,
  /\/(meet-tieghan|recipe-index|recipe-archives|recipe-collections|privacy-policy)(\/|$)/,
  /how-to-|-gift-guide|gift-guides|-round-?up|-menu-and-guide|most-popular|recipes-to-cook|favorite-.*recipes|favorite-things|reader-survey/,
  /-recipes$|\/recipes$/,
];

const SKIP_TITLE = [
  /^\s*\d+\s/, // "30 Deliciously Popular..." — a numbered roundup
  /\bmost[- ]popular\b/i,
  /\bfavorite\b/i,
  /\bround[- ]?up\b/i,
  /\bguide\b/i,
  /\bhow to\b/i,
  /\brecipes\b/i, // plural in the title → a collection, not one dish
];

/** True when the URL+title look like a single recipe worth fetching. */
export function isRecipeSource(item: { url: string; title?: string }): boolean {
  if (SKIP_URL.some((re) => re.test(item.url))) return false;
  const title = item.title;
  if (title && SKIP_TITLE.some((re) => re.test(title))) return false;
  return true;
}
