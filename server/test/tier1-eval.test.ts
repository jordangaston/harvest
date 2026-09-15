import { describe, it, expect } from 'vitest';
import { buildTriplets, tripletAccuracy, type RecipeFacets } from '../src/eval/recsys/triplets.js';
import { rareIngredientProbe } from '../src/eval/recsys/probes.js';
import type { Recommender } from '../src/eval/recsys/types.js';
import type { TasteProfile } from '../src/ranking/taste/taste-profile.js';

/** Tier 1: triplet generation + accuracy, the rare-ingredient probe, and known-answer checking. */

const CORPUS: RecipeFacets[] = [
  { id: 'r1', cuisines: ['italian'], dishTypes: ['pasta'] },
  { id: 'r2', cuisines: ['italian'], dishTypes: ['pasta'] }, // positive for r1 (shares both)
  { id: 'r3', cuisines: ['italian'], dishTypes: ['pizza'] }, // shares only cuisine — not a positive
  { id: 'r4', cuisines: ['thai'], dishTypes: ['soup'] }, // negative for r1 (shares neither)
  { id: 'r5', cuisines: ['thai'], dishTypes: ['curry'] }, // negative for r1
];

describe('buildTriplets', () => {
  it('is deterministic for a seed', () => {
    const a = buildTriplets(CORPUS, { seed: 7, capPerAnchor: 5 });
    const b = buildTriplets(CORPUS, { seed: 7, capPerAnchor: 5 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('positive shares both axes; negative shares neither', () => {
    const triplets = buildTriplets(CORPUS, { seed: 1, capPerAnchor: 5 });
    for (const t of triplets) {
      const by = (id: string) => CORPUS.find((r) => r.id === id)!;
      const a = by(t.anchor);
      const pos = by(t.positive);
      const neg = by(t.negative);
      // positive: overlaps on BOTH cuisine and dish
      expect(a.cuisines.some((c) => pos.cuisines.includes(c))).toBe(true);
      expect(a.dishTypes.some((d) => pos.dishTypes.includes(d))).toBe(true);
      // negative: overlaps on NEITHER
      expect(a.cuisines.some((c) => neg.cuisines.includes(c))).toBe(false);
      expect(a.dishTypes.some((d) => neg.dishTypes.includes(d))).toBe(false);
    }
  });

  it('drops anchors with an empty positive or negative pool', () => {
    // r3 (italian/pizza): no other recipe shares both → no positive; must not be an anchor.
    // A lone recipe sharing nothing with anyone likewise yields no triplets.
    const lonely: RecipeFacets[] = [
      { id: 'x', cuisines: ['martian'], dishTypes: ['goo'] },
      { id: 'y', cuisines: ['venusian'], dishTypes: ['sludge'] },
    ];
    expect(buildTriplets(lonely, { seed: 1, capPerAnchor: 5 })).toEqual([]);
    const triplets = buildTriplets(CORPUS, { seed: 1, capPerAnchor: 5 });
    expect(triplets.some((t) => t.anchor === 'r3')).toBe(false);
  });

  it('honors capPerAnchor', () => {
    const many: RecipeFacets[] = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, cuisines: ['italian'], dishTypes: ['pasta'] }));
    many.push({ id: 'neg', cuisines: ['thai'], dishTypes: ['soup'] });
    const triplets = buildTriplets(many, { seed: 1, capPerAnchor: 2 });
    const perAnchor = new Map<string, number>();
    for (const t of triplets) perAnchor.set(t.anchor, (perAnchor.get(t.anchor) ?? 0) + 1);
    for (const n of perAnchor.values()) expect(n).toBeLessThanOrEqual(2);
  });
});

describe('tripletAccuracy', () => {
  // A toy model: scores the positive higher iff the id sorts before the negative (rigged perfect).
  const perfect: Recommender = {
    name: 'perfect',
    rankScored: (anchor, cands) => cands.map((id) => ({ id, score: id === anchorTwin[anchor] ? 1 : 0 })),
  };
  const anchorTwin: Record<string, string> = { a: 'p' };

  it('is 1.0 when the model always ranks the positive above the negative', () => {
    const s = tripletAccuracy(perfect, [{ anchor: 'a', positive: 'p', negative: 'n' }]);
    expect(s.accuracy).toBe(1);
  });

  it('counts a tie (equal scores) as 0.5', () => {
    const flat: Recommender = { name: 'flat', rankScored: (_a, cands) => cands.map((id) => ({ id, score: 0 })) };
    expect(tripletAccuracy(flat, [{ anchor: 'a', positive: 'p', negative: 'n' }]).accuracy).toBe(0.5);
  });
});

describe('rareIngredientProbe', () => {
  it('measures the top-K share of the anchor rare ingredient', () => {
    // rare base 'saffron' (df=1) is in a1, a2; common 'salt' (df=99) everywhere.
    const profiles = new Map<string, TasteProfile>([
      ['a1', { saffron: 1, salt: 0.1 }],
      ['a2', { saffron: 1, salt: 0.1 }],
      ['b1', { salt: 1 }],
      ['b2', { salt: 1 }],
    ]);
    const df = new Map([['saffron', 1], ['salt', 99]]);
    // A model that returns candidates in given order: put the saffron-sharer first for a1.
    const model: Recommender = {
      name: 'toy',
      rankScored: (anchor, cands) => cands.map((id) => ({ id, score: id === 'a2' && anchor === 'a1' ? 1 : 0 })),
    };
    const p = rareIngredientProbe(model, profiles, df, { dfThreshold: 5, topK: 1, maxAnchors: 10, seed: 1 });
    expect(p.n).toBe(2); // a1, a2 both carry the rare ingredient
    expect(p.share).toBeGreaterThan(0); // a1's top-1 (a2) shares saffron
  });
});
