import { describe, it, expect } from 'vitest';
import { RecipeTasteProfiler } from '../src/ranking/taste/recipe-taste-profiler.js';

describe('RecipeTasteProfiler', () => {
  // salt in every recipe (ubiquitous → idf 0); saffron in one (rare → high idf).
  const byRecipe = new Map<string, string[]>([
    ['r1', ['salt', 'tomato', 'saffron']],
    ['r2', ['salt', 'tomato']],
    ['r3', ['salt', 'fish_sauce']],
  ]);
  const { distinctiveness, profiles } = new RecipeTasteProfiler().build(byRecipe);
  const idf = new Map(distinctiveness.map((d) => [d.baseIngredientId, d.idf]));

  it('drops ubiquitous ingredients (idf → 0) from every profile', () => {
    expect(idf.get('salt')).toBe(0); // df = N → ln(N/(1+N)) < 0 → clamped 0
    for (const p of profiles.values()) expect(p.salt).toBeUndefined();
  });

  it('weights a rare ingredient above a common one', () => {
    expect(idf.get('saffron')!).toBeGreaterThan(idf.get('tomato')!);
  });

  it('L2-normalizes each profile', () => {
    for (const p of profiles.values()) {
      const ss = Object.values(p).reduce((a, w) => a + w * w, 0);
      expect(ss).toBeCloseTo(1);
    }
  });

  it('records document frequency', () => {
    expect(distinctiveness.find((d) => d.baseIngredientId === 'tomato')!.documentFrequency).toBe(2);
  });
});
