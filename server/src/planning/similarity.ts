import type { CandidateRecipe } from './types.js';

/** The recipe's category facet values, flattened for a set comparison. Facet-prefixed so a "chicken"
 * cuisine can't collide with a "chicken" ingredient. */
function facetValues(r: CandidateRecipe): Set<string> {
  const { cuisine, dishType, primaryIngredient } = r.categories;
  return new Set([...cuisine.map((v) => `c:${v}`), ...dishType.map((v) => `d:${v}`), ...primaryIngredient.map((v) => `i:${v}`)]);
}

/** Jaccard overlap of two recipes' category facets, in [0,1]. Two recipes with no categories are
 * treated as maximally dissimilar (0) — absence of data is not evidence of sameness. */
export function similarity(a: CandidateRecipe, b: CandidateRecipe): number {
  const A = facetValues(a);
  const B = facetValues(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
