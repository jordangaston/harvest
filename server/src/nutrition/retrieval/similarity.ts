/**
 * Character-bigram Dice coefficient in [0, 1]. `1` for identical strings, high for a one-letter typo
 * (`spinnach`~`spinach`), low for different words that merely share trigrams (`cumin`~`cucumber`).
 * The FoodMatcher's reject floor uses this to keep typo matches while dropping trigram flukes.
 */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let shared = 0;
  for (const g of ba) if (bb.has(g)) shared++;
  return (2 * shared) / (ba.size + bb.size);
}

function bigrams(s: string): Set<string> {
  const t = s.toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
