import { normalize } from './normalize.js';
import { rrfFuse } from './retrieval/rrf.js';
import { diceSimilarity } from './retrieval/similarity.js';
import type { FdcFoodRepository, FdcFoodCandidate } from './fdc-food-repository.js';

/** A resolved ingredient→food match, with the confidence tier the estimator surfaces. */
export interface FoodMatch {
  fdcId: number;
  category: string | null;
  quality: 'high' | 'medium' | 'low';
}

/** The matcher capability consumers depend on (lets the categorizer inject a stub). */
export interface IngredientMatcher {
  match(name: string): Promise<FoodMatch | null>;
}

/** RRF rank constant — smooths the head of each list (standard default). */
const RRF_K = 60;
/** Reject floor: the matched food must share a token this close (char-bigram Dice) to an ingredient
 * token, else it's a fluke (cumin→cucumber ≈ 0.4) not a real match — while a typo passes
 * (spinnach→spinach ≈ 0.92). Tunable (Q-02) — calibrated so the fixture typo survives. */
const MIN_TOKEN_SIMILARITY = 0.5;

/**
 * Matches a recipe ingredient name to an FDC food by hybrid retrieval: `normalize` → a trigram
 * search (recall, typo-tolerant) and a word search (precision) → fuse by Reciprocal Rank Fusion →
 * keep the fused top only if it clears the reject floor. A food that merely shares character trigrams
 * (cumin/cucumber) either loses the fusion to the real word match or fails the floor.
 */
export class FoodMatcher implements IngredientMatcher {
  constructor(private readonly repo: FdcFoodRepository) {}

  static create(repo: FdcFoodRepository): FoodMatcher {
    return new FoodMatcher(repo);
  }

  /**
   * @param name - a parsed ingredient name (e.g. "salmon fillet, skin on").
   * @returns the fused best match, or null when nothing clears the reject floor.
   */
  async match(name: string): Promise<FoodMatch | null> {
    const tokens = normalize(name);
    const [trigram, word] = await Promise.all([this.repo.searchTrigrams(tokens), this.repo.searchWords(tokens)]);
    if (trigram.length === 0 && word.length === 0) return null;

    const byId = new Map<number, FdcFoodCandidate>();
    for (const c of trigram) byId.set(c.fdcId, c);
    for (const c of word) byId.set(c.fdcId, c);

    const topId = rrfFuse([trigram.map((c) => c.fdcId), word.map((c) => c.fdcId)], RRF_K)[0];
    if (topId === undefined) return null;
    const cand = byId.get(topId)!;
    if (!plausible(tokens, cand.descriptionNormalized)) return null;

    const wordAgrees = word.some((c) => c.fdcId === topId);
    return { fdcId: topId, category: cand.category, quality: wordAgrees ? 'high' : 'medium' };
  }
}

/** The reject floor: at least one ingredient token is close (typo-tolerant) to a food token. */
function plausible(tokens: string[], descriptionNormalized: string): boolean {
  const foodTokens = descriptionNormalized.split(/\s+/).filter(Boolean);
  return tokens.some((t) => foodTokens.some((f) => diceSimilarity(t, f) >= MIN_TOKEN_SIMILARITY));
}
