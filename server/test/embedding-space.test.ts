import { describe, it, expect } from 'vitest';
import { buildPpmi, EmbeddingSpace } from '../src/ranking/embedding/embedding-space.js';

describe('buildPpmi', () => {
  it('prunes below minDf and computes positive PMI', () => {
    // N=4; a in 3, b in 2, a&b together in 2 → PPMI = log(2·4/(3·2)) = log(1.333) ≈ 0.2877.
    const bags = [['a', 'b'], ['a', 'b'], ['a', 'c'], ['d', 'e']];
    const ppmi = buildPpmi(bags, 2); // only a (df3) and b (df2) survive; c,d,e pruned
    expect(ppmi.tokens).toEqual(['a', 'b']);
    const ia = ppmi.index.get('a')!;
    const ib = ppmi.index.get('b')!;
    expect(ppmi.matrix[ia]![ib]!).toBeCloseTo(Math.log((2 * 4) / (3 * 2)), 5);
    expect(ppmi.matrix[ia]![ib]!).toBe(ppmi.matrix[ib]![ia]!); // symmetric
  });

  it('clamps negative PMI to 0', () => {
    // a,b co-occur exactly at chance → PMI 0; never-together stays 0.
    const ppmi = buildPpmi([['a', 'b'], ['a', 'b']], 1);
    const ia = ppmi.index.get('a')!;
    const ib = ppmi.index.get('b')!;
    expect(ppmi.matrix[ia]![ib]!).toBe(0);
  });
});

describe('EmbeddingSpace', () => {
  it('places co-occurring-cluster recipes nearer than cross-cluster ones', () => {
    // Two ingredient clusters that never mix → their recipes should separate in the embedding.
    const bags = new Map<string, string[]>();
    for (let i = 0; i < 8; i++) bags.set(`A${i}`, ['a1', 'a2', 'a3']);
    for (let i = 0; i < 8; i++) bags.set(`B${i}`, ['b1', 'b2', 'b3']);
    const space = EmbeddingSpace.build(bags, { minDf: 2, dims: 4, sifA: 1e-3 });

    const withinA = space.similarity('A0', 'A1');
    const crossAB = space.similarity('A0', 'B0');
    expect(withinA).toBeGreaterThan(crossAB);
  });

  it('is deterministic and returns 0 for an unrepresented recipe', () => {
    const bags = new Map<string, string[]>([
      ['A0', ['a1', 'a2', 'a3']],
      ['A1', ['a1', 'a2', 'a3']],
      ['A2', ['a1', 'a2', 'a3']],
    ]);
    const s1 = EmbeddingSpace.build(bags, { minDf: 2, dims: 2, sifA: 1e-3 });
    const s2 = EmbeddingSpace.build(bags, { minDf: 2, dims: 2, sifA: 1e-3 });
    expect(s1.similarity('A0', 'A1')).toBeCloseTo(s2.similarity('A0', 'A1'), 10);
    expect(s1.similarity('A0', 'ghost')).toBe(0);
  });
});
