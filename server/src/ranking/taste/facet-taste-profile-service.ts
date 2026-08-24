import { type TasteProfile, normalize } from './taste-profile.js';
import { TasteSpace } from './taste-space.js';
import { TasteRepository, type AffinityFacet, type CategoryFacet } from './taste-repository.js';

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
    return (await this.tasteProfiles([{ facet, value }])).get(`${facet}:${value}`)!;
  }

  /** Resolve many facet-likes at once — one DB query for the uncached category facets (no N+1). */
  async tasteProfiles(
    prefs: readonly { facet: AffinityFacet; value: string }[],
  ): Promise<Map<string, TasteProfile>> {
    const out = new Map<string, TasteProfile>();
    const toQuery: { facet: CategoryFacet; value: string; key: string }[] = [];
    for (const { facet, value } of prefs) {
      const key = `${facet}:${value}`;
      const cached = out.get(key) ?? this.cache.get(key);
      if (cached) out.set(key, cached);
      // An ingredient-like is already a base-ingredient dimension — no recipe lookup needed.
      else if (facet === 'ingredient') this.remember(key, normalize({ [value]: 1 }), out);
      else toQuery.push({ facet, value, key });
    }
    if (toQuery.length > 0) {
      const idsByPair = await this.repo.recipeIdsByFacets(toQuery);
      for (const { facet, value, key } of toQuery) {
        this.remember(key, this.space.centroidOf(idsByPair.get(`${facet}:${value}`) ?? []), out);
      }
    }
    return out;
  }

  private remember(key: string, profile: TasteProfile, out: Map<string, TasteProfile>): void {
    this.cache.set(key, profile);
    out.set(key, profile);
  }
}
