import { describe, it, expect } from 'vitest';
import { cosine, centroid, normalize } from '../src/ranking/taste/taste-profile.js';
import { TasteSpace, type AnchorSet } from '../src/ranking/taste/taste-space.js';
import { FacetTasteProfileService } from '../src/ranking/taste/facet-taste-profile-service.js';
import { AnchorResolver } from '../src/ranking/taste/anchor-resolver.js';
import type { TasteRepository } from '../src/ranking/taste/taste-repository.js';

// Two clean clusters in taste space: "italian-ish" (tomato/garlic/basil) and "thai-ish" (fish/coconut/lime).
const IT1 = normalize({ tomato: 1, garlic: 1, basil: 1 });
const IT2 = normalize({ tomato: 1, garlic: 1, cheese: 1 });
const TH1 = normalize({ fish_sauce: 1, coconut: 1, lime: 1 });
const TH2 = normalize({ fish_sauce: 1, coconut: 1, chili: 1 });
const space = new TasteSpace(new Map([['it1', IT1], ['it2', IT2], ['th1', TH1], ['th2', TH2]]));
const all = ['it1', 'it2', 'th1', 'th2'];
const set = (anchors: AnchorSet['anchors'], dislikes: AnchorSet['dislikes'] = []): AnchorSet => ({ anchors, dislikes });

describe('taste-profile math', () => {
  it('cosine: shared dims raise similarity, disjoint = 0', () => {
    expect(cosine(IT1, IT1)).toBeCloseTo(1);
    expect(cosine(IT1, IT2)).toBeGreaterThan(cosine(IT1, TH1));
    expect(cosine(IT1, TH1)).toBe(0);
  });
  it('centroid is heaviest on the shared dimension', () => {
    const c = centroid([IT1, IT2]);
    expect(c.tomato).toBeGreaterThan(c.basil!);
    expect(Object.keys(centroid([]))).toHaveLength(0);
  });
});

describe('TasteSpace.source', () => {
  it('ranks the anchor cluster ahead of the far cluster', () => {
    const out = space.source(set([{ profile: IT1, weight: 1 }]), all, 4)!;
    expect(out.slice(0, 2).sort()).toEqual(['it1', 'it2']);
  });
  it('a dislike pushes its neighbourhood down', () => {
    const liked = space.source(set([{ profile: centroid([IT1, TH1]), weight: 1 }]), all, 4)!;
    const disliked = space.source(set([{ profile: centroid([IT1, TH1]), weight: 1 }], [TH1]), all, 4)!;
    expect(disliked.indexOf('th1')).toBeGreaterThan(liked.indexOf('th1'));
  });
  it('returns null when there are no anchors (caller falls back)', () => {
    expect(space.source(set([]), all, 4)).toBeNull();
  });
});

// A stub repo lets us unit-test the resolvers without a database.
function stubRepo(over: Partial<TasteRepository>): TasteRepository {
  return {
    allProfiles: async () => new Map(),
    recipeIdsByFacet: async () => [],
    userSwipes: async () => [],
    userFoodPrefs: async () => [],
    ...over,
  } as unknown as TasteRepository;
}

describe('FacetTasteProfileService', () => {
  it('a cuisine profile is the centroid of its tagged recipes', async () => {
    const repo = stubRepo({ recipeIdsByFacet: async () => ['it1', 'it2'] });
    const svc = FacetTasteProfileService.create(space, repo);
    expect(await svc.tasteProfile('cuisine', 'italian')).toEqual(centroid([IT1, IT2]));
  });
  it('an ingredient-like resolves to a unit direction, no recipe lookup', async () => {
    const svc = FacetTasteProfileService.create(space, stubRepo({}));
    expect(await svc.tasteProfile('ingredient', 'tomato')).toEqual(normalize({ tomato: 1 }));
  });
  it('memoizes per (facet,value)', async () => {
    let calls = 0;
    const repo = stubRepo({ recipeIdsByFacet: async () => (calls++, ['it1']) });
    const svc = FacetTasteProfileService.create(space, repo);
    await svc.tasteProfile('cuisine', 'italian');
    await svc.tasteProfile('cuisine', 'italian');
    expect(calls).toBe(1);
  });
});

describe('AnchorResolver', () => {
  it('merges swipes (recipe anchors + dislikes) and stated facet-likes', async () => {
    const repo = stubRepo({
      userSwipes: async () => [
        { recipeId: 'it1', direction: 'like' },
        { recipeId: 'th1', direction: 'dislike' },
      ],
      userFoodPrefs: async () => [{ facet: 'ingredient', value: 'coconut', sentiment: 'like' }],
    });
    const anchors = await AnchorResolver.create(space, repo).anchors('u1');
    expect(anchors.anchors).toHaveLength(2); // it1 recipe + coconut facet
    expect(anchors.dislikes).toHaveLength(1); // th1
    expect(anchors.anchors.some((a) => a.profile.coconut === 1)).toBe(true);
  });
});
