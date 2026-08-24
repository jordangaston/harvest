/**
 * A recipe's (or a facet's, or a user anchor's) position in taste space: a sparse map of
 * `base_ingredient_id → weight`, built IDF-weighted and L2-normalized by the RecipeTasteProfiler.
 * The math here is the whole affinity primitive — pure functions over these sparse maps.
 */
export type TasteProfile = Record<string, number>;

/** Cosine similarity of two L2-normalized sparse profiles = their dot product over shared keys. */
export function cosine(a: TasteProfile, b: TasteProfile): number {
  // Iterate the smaller map; only shared dimensions contribute.
  const [small, big] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let dot = 0;
  for (const k in small) {
    const v = big[k];
    if (v !== undefined) dot += small[k]! * v;
  }
  return dot;
}

/** The centroid (mean) of profiles, L2-normalized. Empty input → empty profile. */
export function centroid(profiles: TasteProfile[]): TasteProfile {
  const sum: TasteProfile = {};
  for (const p of profiles) for (const k in p) sum[k] = (sum[k] ?? 0) + p[k]!;
  return normalize(sum);
}

/** L2-normalize a sparse profile; a zero vector normalizes to empty. */
export function normalize(p: TasteProfile): TasteProfile {
  let ss = 0;
  for (const k in p) ss += p[k]! * p[k]!;
  const norm = Math.sqrt(ss);
  if (norm === 0) return {};
  const out: TasteProfile = {};
  for (const k in p) out[k] = p[k]! / norm;
  return out;
}
