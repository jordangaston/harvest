import { type TasteProfile, normalize } from './taste-profile.js';
import { TasteSpace } from './taste-space.js';
import { TasteRepository, type AffinityFacet } from './taste-repository.js';

/**
 * The typical taste of a facet value (cuisine "italian", dish_type "burger") — the centroid of
 * the recipes carrying that tag. Derived on the fly from the in-memory space and memoized per
 * `(facet, value)` (D-09: no stored table). An `ingredient` like resolves to a unit direction
 * on that base ingredient. Resolution is a tag lookup, never title/text matching (D-10).
 */
export class FacetTasteProfileService {
  private readonly cache = new Map<string, TasteProfile>();

  constructor(
    private readonly space: TasteSpace,
    private readonly repo: TasteRepository,
  ) {}

  static create(space: TasteSpace, repo: TasteRepository): FacetTasteProfileService {
    return new FacetTasteProfileService(space, repo);
  }

  /** The facet value's taste profile (empty if no tagged recipes / unknown ingredient). */
  async tasteProfile(facet: AffinityFacet, value: string): Promise<TasteProfile> {
    const key = `${facet}:${value}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    // An ingredient-like is already a base-ingredient dimension — no recipe lookup needed.
    const profile =
      facet === 'ingredient'
        ? normalize({ [value]: 1 })
        : this.space.centroidOf(await this.repo.recipeIdsByFacet(facet, value));
    this.cache.set(key, profile);
    return profile;
  }
}
