import { describe, it, expect } from 'vitest';
import { precisionAtK, ndcgAtK, spearman, evaluateGraded } from '../src/eval/recsys/metrics.js';
import { mineDisagreements } from '../src/eval/recsys/mine.js';
import type { Recommender } from '../src/eval/recsys/types.js';

/** Score a fixed order regardless of anchor — lets tests pin a model's ranking. Returns sorted
 * best→worst, honoring the Recommender contract that `rankScored` output is ordered. */
function fixedOrder(name: string, order: string[]): Recommender {
  return {
    name,
    rankScored: (_a, cands) => cands.map((id) => ({ id, score: -order.indexOf(id) })).sort((x, y) => y.score - x.score),
  };
}

describe('precisionAtK', () => {
  it('counts relevant in the top-k over the labeled set', () => {
    const ranked = ['a', 'b', 'c', 'd'];
    const labels = { a: 2, b: 0, c: 1, d: 0 }; // a,c relevant
    expect(precisionAtK(ranked, labels, 2)).toBe(0.5); // top-2 = a,b → 1 relevant / 2
    expect(precisionAtK(ranked, labels, 4)).toBe(0.5); // 2 relevant / 4
  });
});

describe('ndcgAtK', () => {
  it('is 1.0 for an ideal ranking and <1 when a relevant item is buried', () => {
    const labels = { a: 3, b: 2, c: 0 };
    expect(ndcgAtK(['a', 'b', 'c'], labels, 3)).toBeCloseTo(1, 6);
    const worse = ndcgAtK(['c', 'b', 'a'], labels, 3);
    expect(worse).toBeLessThan(1);
    expect(worse).toBeGreaterThan(0);
  });
  it('is 0 when nothing is relevant', () => {
    expect(ndcgAtK(['a', 'b'], { a: 0, b: 0 }, 2)).toBe(0);
  });
});

describe('spearman', () => {
  it('is 1 for perfectly concordant, -1 for reversed', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 6);
  });
  it('handles ties without NaN', () => {
    expect(Number.isNaN(spearman([1, 1, 2], [5, 5, 9]))).toBe(false);
  });
});

describe('evaluateGraded', () => {
  it('rewards a model whose ranking matches the labels', () => {
    const gold = [{ anchor: 'q', labels: { a: 3, b: 1, c: 0 } }];
    const good = evaluateGraded(fixedOrder('good', ['a', 'b', 'c']), gold, 3);
    const bad = evaluateGraded(fixedOrder('bad', ['c', 'b', 'a']), gold, 3);
    expect(good.ndcgAtK).toBeGreaterThan(bad.ndcgAtK);
    expect(good.ndcgAtK).toBeCloseTo(1, 6);
    expect(good.nQueries).toBe(1);
  });
});

describe('mineDisagreements', () => {
  it('surfaces the candidates the two models rank most differently', () => {
    const cands = ['x', 'y', 'z'];
    const a = fixedOrder('a', ['x', 'y', 'z']); // x best
    const b = fixedOrder('b', ['z', 'y', 'x']); // x worst
    const mined = mineDisagreements('q', cands, a, b, 2);
    // x: rankA 0, rankB 2 → disagreement 2 (max); y: 1,1 → 0.
    expect(mined[0]!.candidate).toBe('x');
    expect(mined[0]!.disagreement).toBe(2);
    expect(mined.length).toBe(2);
    expect(mined.some((m) => m.candidate === 'y')).toBe(false); // y (0 disagreement) not in top-2? z=2,x=2,y=0
  });
});
