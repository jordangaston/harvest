import { describe, it, expect } from 'vitest';
import { rrfFuse } from '../src/nutrition/retrieval/rrf.js';
import { diceSimilarity } from '../src/nutrition/retrieval/similarity.js';

describe('rrfFuse', () => {
  it('a candidate ranked in two lists beats one ranked #1 in a single list', () => {
    // "cumin↔cucumber" shape: cucumber tops the trigram list alone; the real food ranks in both.
    const fused = rrfFuse([['cucumber', 'cumin'], ['spice', 'cumin']]);
    expect(fused[0]).toBe('cumin');
  });
  it('is deterministic and unweighted (single list = identity order)', () => {
    expect(rrfFuse([['x', 'y', 'z']])).toEqual(['x', 'y', 'z']);
  });
  it('empty input → empty', () => {
    expect(rrfFuse([])).toEqual([]);
  });
});

describe('diceSimilarity (the reject floor signal)', () => {
  it('identical → 1', () => {
    expect(diceSimilarity('spinach', 'spinach')).toBe(1);
  });
  it('a one-letter typo stays high — clears the floor', () => {
    expect(diceSimilarity('spinnach', 'spinach')).toBeGreaterThanOrEqual(0.5);
  });
  it('a trigram-similar but different word stays low — fails the floor', () => {
    expect(diceSimilarity('cumin', 'cucumber')).toBeLessThan(0.5);
  });
});
