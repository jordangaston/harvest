import type { Recommender } from './types.js';

/** A weak-supervision triplet: the positive is metadata-similar to the anchor, the negative shares
 * nothing. A model is "right" on it when sim(anchor, positive) > sim(anchor, negative). */
export interface Triplet {
  anchor: string;
  positive: string;
  negative: string;
}

/** A recipe's two triplet axes (cuisine + dish form). `primary_ingredient`/`course` are excluded
 * by design — the positive keys on cuisine ∩ dish_type only. */
export interface RecipeFacets {
  id: string;
  cuisines: string[];
  dishTypes: string[];
}

export interface TripletOptions {
  seed: number;
  /** Max positives (⇒ triplets) per anchor, so a popular cuisine can't swamp the set. */
  capPerAnchor: number;
  /** Optional cap on how many eligible anchors to use (seeded sample) — bounds cost + file size
   * over a large corpus. Omit to use every eligible anchor. */
  maxAnchors?: number;
}

/** Deterministic PRNG (mulberry32) → [0,1). Seeded so the generated set is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates with the given rng (returns the same array for chaining). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Build the Tier 1 triplet set from recipe metadata, deterministically for a given seed.
 *
 * For each anchor with ≥1 cuisine AND ≥1 dish form: the positive pool is recipes sharing ≥1 value
 * on **both** axes; the negative pool is recipes sharing **nothing** on either. Anchors with an
 * empty pool on either side are dropped. Up to `capPerAnchor` positives are sampled per anchor, each
 * paired with a sampled negative. Anchors are visited in sorted-id order and all sampling uses one
 * seeded rng, so the output is stable across runs.
 *
 * @returns deduped triplets (a triplet is unique by anchor+positive+negative).
 */
export function buildTriplets(recipes: RecipeFacets[], opts: TripletOptions): Triplet[] {
  const rng = mulberry32(opts.seed);
  const byCuisine = new Map<string, Set<string>>();
  const byDish = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, id: string) => {
    const s = m.get(key) ?? new Set<string>();
    s.add(id);
    m.set(key, s);
  };
  for (const r of recipes) {
    for (const c of r.cuisines) add(byCuisine, c, r.id);
    for (const d of r.dishTypes) add(byDish, d, r.id);
  }
  const allIds = recipes.map((r) => r.id);

  let eligible = recipes.filter((r) => r.cuisines.length > 0 && r.dishTypes.length > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (opts.maxAnchors !== undefined && opts.maxAnchors < eligible.length) {
    // Seeded sample, then re-sort so processing order (and rng consumption) stays deterministic.
    eligible = shuffle([...eligible], rng).slice(0, opts.maxAnchors).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  const seen = new Set<string>();
  const triplets: Triplet[] = [];

  for (const a of eligible) {
    const sharesCuisine = union(a.cuisines.map((c) => byCuisine.get(c)));
    const sharesDish = union(a.dishTypes.map((d) => byDish.get(d)));
    // Positive: shares ≥1 on both axes. Iterate the smaller set, keep members of the other.
    const [small, big] = sharesCuisine.size <= sharesDish.size ? [sharesCuisine, sharesDish] : [sharesDish, sharesCuisine];
    const positivePool = [...small].filter((id) => id !== a.id && big.has(id));
    // Negative: shares nothing on either axis.
    const negativePool = allIds.filter((id) => id !== a.id && !sharesCuisine.has(id) && !sharesDish.has(id));
    if (positivePool.length === 0 || negativePool.length === 0) continue;

    const positives = shuffle([...positivePool], rng).slice(0, opts.capPerAnchor);
    for (const positive of positives) {
      const negative = negativePool[Math.floor(rng() * negativePool.length)]!;
      const key = `${a.id}|${positive}|${negative}`;
      if (seen.has(key)) continue;
      seen.add(key);
      triplets.push({ anchor: a.id, positive, negative });
    }
  }
  return triplets;
}

/** Union of the given id-sets (undefined sets skipped). */
function union(sets: (Set<string> | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) if (s) for (const id of s) out.add(id);
  return out;
}

/** A model's Tier 1 headline: fraction of triplets it orders correctly (a tie counts as 0.5). */
export interface TripletScore {
  name: string;
  accuracy: number;
  n: number;
}

/**
 * Triplet accuracy: fraction of triplets where sim(anchor, positive) > sim(anchor, negative), read
 * from the model's own scores over the 2-candidate pool. A tie (equal score, e.g. both candidates
 * unprofiled) counts as 0.5 — no credit for guessing.
 */
export function tripletAccuracy(rec: Recommender, triplets: Triplet[]): TripletScore {
  let correct = 0;
  for (const t of triplets) {
    const scored = rec.rankScored(t.anchor, [t.positive, t.negative]);
    const pos = scored.find((s) => s.id === t.positive)?.score ?? 0;
    const neg = scored.find((s) => s.id === t.negative)?.score ?? 0;
    correct += pos > neg ? 1 : pos < neg ? 0 : 0.5;
  }
  return { name: rec.name, accuracy: triplets.length === 0 ? 0 : correct / triplets.length, n: triplets.length };
}
