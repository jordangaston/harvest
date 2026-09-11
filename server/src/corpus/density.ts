/** Corpus density measurement for the embedding build. PMI only converges to the true co-occurrence
 * distribution with enough well-spread data, and the rare tail converges slowest — so the gate is a
 * density rule, not a raw count. Pure functions over in-memory counts; the script is a thin db adapter. */

export interface IngredientDensity {
  nRecipes: number;
  nIngredients: number;
  /** The rank we check the rule at (default 200). */
  rank: number;
  /** Document frequency of the ingredient at `rank` (0 if fewer ingredients exist). */
  rankDf: number;
  /** The rule threshold (default 30 recipes). */
  dfRule: number;
  /** The density rule: the `rank`-th most-common ingredient still appears in ≥ `dfRule` recipes. */
  rulePasses: boolean;
  /** How many ingredients clear the rule (df ≥ dfRule). */
  ingredientsMeetingRule: number;
  /** df distribution in coarse buckets, for a quick shape read. */
  histogram: { bucket: string; count: number }[];
}

/**
 * Measure per-ingredient density against the rule "the `rank`-th most-common base ingredient still
 * appears in ≥ `dfRule` recipes". `dfs` is every base ingredient's document frequency (any order).
 */
export function measureIngredientDensity(dfs: number[], nRecipes: number, rank = 200, dfRule = 30): IngredientDensity {
  const desc = [...dfs].sort((a, b) => b - a);
  const rankDf = desc[rank - 1] ?? 0;
  const buckets: [string, (d: number) => boolean][] = [
    ['1', (d) => d === 1],
    ['2–9', (d) => d >= 2 && d <= 9],
    ['10–29', (d) => d >= 10 && d <= 29],
    ['30–99', (d) => d >= 30 && d <= 99],
    ['100–999', (d) => d >= 100 && d <= 999],
    ['1000+', (d) => d >= 1000],
  ];
  return {
    nRecipes,
    nIngredients: dfs.length,
    rank,
    rankDf,
    dfRule,
    rulePasses: rankDf >= dfRule,
    ingredientsMeetingRule: dfs.filter((d) => d >= dfRule).length,
    histogram: buckets.map(([bucket, pred]) => ({ bucket, count: dfs.filter(pred).length })),
  };
}

export interface PairDensity {
  /** Distinct base-ingredient pairs that co-occur in ≥1 recipe. */
  coOccurringPairs: number;
  /** Pairs whose co-occurrence count is ≥ each threshold — the PMI-stable tail. */
  pairsAtLeast: { threshold: number; count: number }[];
}

/**
 * Measure per-pair co-occurrence density. `ingredientSets` is each recipe's set of base-ingredient
 * ids (e.g. its taste-profile keys). Reports how many distinct pairs clear each count threshold —
 * the fraction of the pair space PMI can actually estimate.
 */
export function measurePairDensity(ingredientSets: string[][], thresholds = [2, 5, 10, 30]): PairDensity {
  const counts = new Map<string, number>();
  for (const set of ingredientSets) {
    const ids = [...new Set(set)].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const values = [...counts.values()];
  return {
    coOccurringPairs: counts.size,
    pairsAtLeast: thresholds.map((t) => ({ threshold: t, count: values.filter((v) => v >= t).length })),
  };
}
