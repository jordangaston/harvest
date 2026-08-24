import { type TasteProfile, cosine, centroid } from './taste-profile.js';

/** A weighted seed for the walk: a liked recipe (its profile) or a stated facet-like (its centroid). */
export interface Anchor {
  profile: TasteProfile;
  weight: number;
}

/** What a user likes (anchors) and dislikes (repulsors), resolved into taste space. */
export interface AnchorSet {
  anchors: Anchor[];
  dislikes: TasteProfile[];
}

/** How hard a disliked neighbourhood pushes a candidate down (subtracted from activation). */
const DISLIKE_WEIGHT = 1.0;

/**
 * Recipes as points in taste space (D-06: the whole set held in memory, brute-forced). The walk
 * sources a deck by scoring candidates against the user's anchors — this is where affinity drives
 * sourcing (P2). v1 is multi-anchor weighted cosine; the k-NN spreading-activation graph is v1.1.
 */
export class TasteSpace {
  constructor(private readonly profiles: Map<string, TasteProfile>) {}

  get size(): number {
    return this.profiles.size;
  }

  profile(recipeId: string): TasteProfile | undefined {
    return this.profiles.get(recipeId);
  }

  /** The centroid of the given recipes' profiles (missing profiles skipped). */
  centroidOf(recipeIds: string[]): TasteProfile {
    const ps: TasteProfile[] = [];
    for (const id of recipeIds) {
      const p = this.profiles.get(id);
      if (p) ps.push(p);
    }
    return centroid(ps);
  }

  /**
   * Source `candidateIds` as the top-k by affinity to the anchor set.
   * activation(c) = Σ anchor.weight·cosine(anchor, c) − DISLIKE_WEIGHT·max cosine(dislike, c).
   * Returns `null` when there are no anchors (caller falls back to the non-affinity path).
   * ponytail: pure top-k; real diversity/novelty exploration is an eval-gated follow-up (design Q-03).
   */
  source(anchors: AnchorSet, candidateIds: string[], k: number): string[] | null {
    if (anchors.anchors.length === 0) return null;
    const ranked = candidateIds
      .filter((id) => this.profiles.has(id))
      .map((id) => ({ id, s: this.activation(anchors, id) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.id);
    // Candidates with no profile (e.g. a freshly seeded recipe) can't be scored — keep them at the
    // tail rather than dropping them, so affinity reorders the deck without shrinking it.
    const unscorable = candidateIds.filter((id) => !this.profiles.has(id));
    return [...ranked, ...unscorable];
  }

  private activation(anchors: AnchorSet, recipeId: string): number {
    const p = this.profiles.get(recipeId)!;
    let s = 0;
    for (const a of anchors.anchors) s += a.weight * cosine(a.profile, p);
    let pen = 0;
    for (const d of anchors.dislikes) pen = Math.max(pen, cosine(d, p));
    return s - DISLIKE_WEIGHT * pen;
  }
}
