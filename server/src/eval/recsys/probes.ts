import type { TasteProfile } from '../../ranking/taste/taste-profile.js';
import { rankIds, type Recommender } from './types.js';

/** Deterministic PRNG (mulberry32) for reproducible anchor sampling. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ProbeScore {
  name: string;
  /** Mean fraction of each anchor's top-K neighbors that share its rare base ingredient. */
  share: number;
  /** Anchors probed. */
  n: number;
}

export interface RareIngredientOptions {
  /** A base ingredient is "rare" when its corpus document frequency is ≤ this. */
  dfThreshold: number;
  topK: number;
  maxAnchors: number;
  seed: number;
}

/**
 * Rare-ingredient probe: for anchors that contain a low-`df` (distinctive) base ingredient, what
 * fraction of the model's top-K neighbors also contain it? A good similarity model should carry a
 * rare marker (saffron, tamarind) into its neighborhood; random sits at the base rate. Judged per
 * model relative to IDF. Profiles key on `base_ingredient_id`, so "contains X" = X ∈ profile.
 */
export function rareIngredientProbe(
  rec: Recommender,
  profiles: Map<string, TasteProfile>,
  df: Map<string, number>,
  opts: RareIngredientOptions,
): ProbeScore {
  const rng = mulberry32(opts.seed);
  const dfOf = (base: string) => df.get(base) ?? Infinity;

  // Each anchor that has a rare ingredient, tagged with its rarest one (min df).
  const anchors: { id: string; rare: string }[] = [];
  for (const [id, profile] of profiles) {
    let rare: string | null = null;
    for (const base of Object.keys(profile)) {
      if (dfOf(base) <= opts.dfThreshold && (rare === null || dfOf(base) < dfOf(rare))) rare = base;
    }
    if (rare) anchors.push({ id, rare });
  }
  anchors.sort((a, b) => (a.id < b.id ? -1 : 1));
  shuffle(anchors, rng);
  const sample = anchors.slice(0, opts.maxAnchors);

  const allIds = [...profiles.keys()];
  let sum = 0;
  for (const { id, rare } of sample) {
    const candidates = allIds.filter((c) => c !== id);
    const topK = rankIds(rec, id, candidates).slice(0, opts.topK);
    const shared = topK.filter((c) => (profiles.get(c) ?? {})[rare] !== undefined).length;
    sum += topK.length === 0 ? 0 : shared / topK.length;
  }
  return { name: rec.name, share: sample.length === 0 ? 0 : sum / sample.length, n: sample.length };
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
