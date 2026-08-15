import { describe, it, expect } from 'vitest';
import { toRecipeRow, hasRecipe, isSectionLabel } from '../src/mapping.js';
import { classifySource } from '../src/classify.js';
import { extract, fetchSource } from '../src/providers.js';
import type { ImportInput } from '../src/domain.js';

const input: ImportInput = { jobId: 'j1', userId: 'u1', sourceType: 'website', sourceRef: 'https://x.test/r' };

describe('mapping (single chokepoint, ported from server toRecipeInput)', () => {
  it('keeps parsed servings and drops bare section headers', () => {
    const row = toRecipeRow(
      {
        title: 'X',
        servings: '6',
        confidence: 0.9,
        ingredients: [
          { name: 'For the sauce', amount: null, unit: null, quantityText: 'For the sauce' },
          { name: 'garlic', amount: '2', unit: 'cloves', quantityText: '2 cloves garlic' },
        ],
        steps: ['To finish:', 'Simmer the sauce.'],
      },
      input,
    );
    expect(row.servings).toBe(6);
    expect(row.servingsEstimated).toBe(false);
    expect(row.ingredients.map((i) => i.name)).toEqual(['garlic']);
    expect(row.steps).toEqual(['Simmer the sauce.']);
  });

  it('estimates servings (4) when the source omits them', () => {
    const row = toRecipeRow({ title: 'X', confidence: 1, ingredients: [{ name: 'a', amount: null, unit: null, quantityText: null }], steps: [] }, input);
    expect(row.servings).toBe(4);
    expect(row.servingsEstimated).toBe(true);
  });

  it('isSectionLabel is conservative — a real long step is kept', () => {
    expect(isSectionLabel('For the sauce')).toBe(true);
    expect(isSectionLabel('To finish, stir in the cream and parmesan until glossy')).toBe(false);
  });
});

describe('classifySource (host → platform)', () => {
  it('maps known hosts and defaults to website', () => {
    expect(classifySource('https://www.tiktok.com/@x/video/1')?.sourceType).toBe('tiktok');
    expect(classifySource('https://youtu.be/abc')?.sourceType).toBe('youtube');
    expect(classifySource('https://example.com/recipe')?.sourceType).toBe('website');
    expect(classifySource('not a url')).toBeNull();
  });
});

describe('offline providers (hermetic stubs)', () => {
  it('extract yields a usable recipe with no network', async () => {
    const data = await extract(await fetchSource(input));
    expect(hasRecipe(data)).toBe(true);
    expect(data.title).toBe('Creamy Garlic Chicken');
  });
});
