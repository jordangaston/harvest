import { describe, it, expect } from 'vitest';
import { normalize, type TasteProfile } from '../src/ranking/taste/taste-profile.js';
import { TasteSpace } from '../src/ranking/taste/taste-space.js';
import { idfRecommender, randomRecommender, popularityRecommender } from '../src/eval/recsys/recommenders.js';
import { evaluate, formatReport } from '../src/eval/recsys/harness.js';
import type { GoldSet } from '../src/eval/recsys/types.js';

/**
 * eval-harness-core: the frame's own correctness check. On a fixture corpus where each anchor has a
 * near-identical "twin" (the relevant neighbor) plus orthogonal distractors, IDF must rank the twin
 * first, popularity is rigged to rank it second, and random is a shuffle — so the baseline ordering
 * `random < popularity < IDF` holds. If it ever fails, the harness (not the model) is wrong.
 */

const N = 12;
const DISTRACT = 19; // 20-candidate pools keep the random floor (≈ H₂₀/20 ≈ 0.18) well below popularity

function fixture(): { space: TasteSpace; gold: GoldSet; popularity: Map<string, number> } {
  const profiles = new Map<string, TasteProfile>();
  const popularity = new Map<string, number>();
  const queries: GoldSet['queries'] = [];

  for (let i = 0; i < N; i++) {
    const anchor = `a${i}`;
    const twin = `p${i}`;
    // Anchor and twin share a unique dominant dimension → cosine ≈ 1; distractors are orthogonal → 0.
    const shape = normalize({ [`d${i}`]: 1, shared: 0.1 });
    profiles.set(anchor, shape);
    profiles.set(twin, { ...shape });

    const candidates = [twin];
    for (let j = 0; j < DISTRACT; j++) {
      const d = `x${i}_${j}`;
      profiles.set(d, normalize({ [`z${i}_${j}`]: 1 }));
      candidates.push(d);
    }
    // Popularity is rigged so the twin is always 2nd (one distractor outranks it) → RR = 1/2.
    popularity.set(candidates[1]!, 100);
    popularity.set(twin, 90);
    candidates.slice(2).forEach((d, k) => popularity.set(d, 80 - k));

    queries.push({ anchor, relevant: [twin], candidates, cuisine: i % 2 ? 'italian' : 'thai' });
  }
  return { space: new TasteSpace(profiles), gold: { queries }, popularity };
}

describe('recsys harness self-test', () => {
  it('holds the baseline ordering random < popularity < IDF', () => {
    const { space, gold, popularity } = fixture();
    const idf = evaluate(idfRecommender(space), gold);
    const random = evaluate(randomRecommender(), gold);
    const pop = evaluate(popularityRecommender(popularity), gold);

    expect(idf.mrr).toBe(1); // twin is the nearest neighbor every time
    expect(pop.mrr).toBe(0.5); // rigged: twin always ranks 2nd
    expect(random.mrr).toBeGreaterThan(0);
    expect(random.mrr).toBeLessThan(pop.mrr);
    expect(pop.mrr).toBeLessThan(idf.mrr);
  });

  it('IDF returns the nearest neighbor first, deterministically', () => {
    const { space } = fixture();
    const idf = idfRecommender(space);
    const cands = ['p3', 'x3_0', 'x3_4', 'x3_1'];
    const first = idf.rankScored('a3', cands);
    expect(first[0]!.id).toBe('p3'); // the twin
    expect(idf.rankScored('a3', cands)).toEqual(first); // same input → same output
  });
});

describe('recsys report', () => {
  it('renders the headline MRR and a per-cuisine table', () => {
    const { space, gold, popularity } = fixture();
    const reports = [
      evaluate(idfRecommender(space), gold),
      evaluate(randomRecommender(), gold),
      evaluate(popularityRecommender(popularity), gold),
    ];
    const text = formatReport(reports);
    expect(text).toContain('idf');
    expect(text).toContain('per-cuisine MRR');
    expect(text).toContain('italian');
    expect(text).toContain('thai');
  });

  it('flags an unavailable model with its note instead of a number', () => {
    const { space, gold } = fixture();
    const empty = popularityRecommender(new Map());
    expect(empty.available).toBe(false);
    const report = evaluate(empty, gold, 'unavailable — recipes.popularity not populated');
    expect(formatReport([evaluate(idfRecommender(space), gold), report])).toContain('unavailable');
  });
});
