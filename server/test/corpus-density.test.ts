import { describe, it, expect } from 'vitest';
import { measureIngredientDensity, measurePairDensity } from '../src/corpus/density.js';

describe('measureIngredientDensity', () => {
  it('passes the rule when the rank-th ingredient clears the df threshold', () => {
    // 5 ingredients all in 40 recipes; rank 3, rule 30 → the 3rd (df 40) clears it.
    const r = measureIngredientDensity([40, 40, 40, 40, 40], 100, 3, 30);
    expect(r.rankDf).toBe(40);
    expect(r.rulePasses).toBe(true);
    expect(r.ingredientsMeetingRule).toBe(5);
  });

  it('fails when the rank-th ingredient is too rare, and 0 when fewer ingredients exist', () => {
    const r = measureIngredientDensity([100, 50, 5, 2, 1], 100, 3, 30);
    expect(r.rankDf).toBe(5); // 3rd-most-common appears in only 5 recipes
    expect(r.rulePasses).toBe(false);
    // rank beyond the list → 0.
    expect(measureIngredientDensity([100, 50], 100, 200, 30).rankDf).toBe(0);
  });

  it('buckets the df distribution', () => {
    const r = measureIngredientDensity([1, 1, 5, 15, 50, 500, 5000], 100);
    const b = Object.fromEntries(r.histogram.map((h) => [h.bucket, h.count]));
    expect(b['1']).toBe(2);
    expect(b['10–29']).toBe(1);
    expect(b['1000+']).toBe(1);
  });
});

describe('measurePairDensity', () => {
  it('counts co-occurring pairs and the threshold tail', () => {
    // (a,b) co-occur 3×, (a,c) once.
    const sets = [['a', 'b'], ['a', 'b'], ['a', 'b', 'c']];
    const r = measurePairDensity(sets, [2, 3]);
    expect(r.coOccurringPairs).toBe(3); // ab, ac, bc
    expect(r.pairsAtLeast.find((p) => p.threshold === 3)!.count).toBe(1); // only ab
    expect(r.pairsAtLeast.find((p) => p.threshold === 2)!.count).toBe(1); // ab (bc=1, ac=1)
  });

  it('dedups repeated ingredients within a recipe', () => {
    expect(measurePairDensity([['a', 'a', 'b']]).coOccurringPairs).toBe(1); // just ab, not a-a
  });
});
