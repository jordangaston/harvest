import { type AnchorSet, TasteSpace } from './taste-space.js';
import { FacetTasteProfileService } from './facet-taste-profile-service.js';
import { TasteRepository } from './taste-repository.js';

/** A save is a stronger signal than a like; a stated facet-like is broad, so it carries a like's weight. */
const WEIGHT = { like: 1, save: 1.5, facet: 1 } as const;

/**
 * Resolves a user's likes into the typed anchors that seed the walk (D-05): liked/saved recipes →
 * their own profiles; stated facet-likes → facet centroids; dislikes → repulsors. This is the only
 * place swipes and stated food prefs merge into one AnchorSet.
 */
export class AnchorResolver {
  constructor(
    private readonly space: TasteSpace,
    private readonly facets: FacetTasteProfileService,
    private readonly repo: TasteRepository,
  ) {}

  static create(space: TasteSpace, repo: TasteRepository): AnchorResolver {
    return new AnchorResolver(space, FacetTasteProfileService.create(space, repo), repo);
  }

  async anchors(userId: string): Promise<AnchorSet> {
    const set: AnchorSet = { anchors: [], dislikes: [] };
    await this.addSwipes(userId, set);
    await this.addFoodPrefs(userId, set);
    return set;
  }

  private async addSwipes(userId: string, set: AnchorSet): Promise<void> {
    for (const s of await this.repo.userSwipes(userId)) {
      const profile = this.space.profile(s.recipeId);
      if (!profile) continue;
      if (s.direction === 'dislike') set.dislikes.push(profile);
      else set.anchors.push({ profile, weight: s.direction === 'save' ? WEIGHT.save : WEIGHT.like });
    }
  }

  private async addFoodPrefs(userId: string, set: AnchorSet): Promise<void> {
    const prefs = await this.repo.userFoodPrefs(userId);
    const profiles = await this.facets.tasteProfiles(prefs); // one query, not one per pref
    for (const p of prefs) {
      const profile = profiles.get(`${p.facet}:${p.value}`)!;
      if (Object.keys(profile).length === 0) continue;
      if (p.direction === 'less') set.dislikes.push(profile);
      else set.anchors.push({ profile, weight: WEIGHT.facet });
    }
  }
}
