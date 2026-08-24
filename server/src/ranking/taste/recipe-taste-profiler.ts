import { type TasteProfile, normalize } from './taste-profile.js';

/** How distinctly a base ingredient marks a dish: its document frequency and IDF over the corpus. */
export interface Distinctiveness {
  baseIngredientId: string;
  documentFrequency: number;
  idf: number;
}

/**
 * Turns the corpus into taste profiles: from each recipe's base-ingredient set it computes
 * `idf = max(0, ln(N / (1 + df)))` (ubiquitous staples → 0, dropped) and each recipe's L2-normalized
 * IDF-weighted profile. Pure over in-memory data — the offline build script is a thin db adapter.
 */
export class RecipeTasteProfiler {
  /** @param byRecipe recipeId → its base-ingredient ids (duplicates tolerated). */
  build(byRecipe: Map<string, string[]>): {
    distinctiveness: Distinctiveness[];
    profiles: Map<string, TasteProfile>;
  } {
    const n = byRecipe.size;
    const df = new Map<string, number>();
    for (const bids of byRecipe.values()) for (const b of new Set(bids)) df.set(b, (df.get(b) ?? 0) + 1);

    const idf = new Map<string, number>();
    for (const [b, d] of df) idf.set(b, Math.max(0, Math.log(n / (1 + d))));

    const profiles = new Map<string, TasteProfile>();
    for (const [recipeId, bids] of byRecipe) {
      const weights: TasteProfile = {};
      for (const b of new Set(bids)) {
        const w = idf.get(b)!;
        if (w > 0) weights[b] = w;
      }
      const profile = normalize(weights);
      if (Object.keys(profile).length > 0) profiles.set(recipeId, profile);
    }

    const distinctiveness = [...df].map(([b, d]) => ({
      baseIngredientId: b,
      documentFrequency: d,
      idf: idf.get(b)!,
    }));
    return { distinctiveness, profiles };
  }
}
