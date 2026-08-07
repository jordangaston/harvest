import { describe, it, expect } from 'vitest';
import { FoodCatalog, type Food } from '../../src/nutrition/food-catalog.js';
import { zeroLabelCore, type LabelCore } from '../../src/nutrition/label-core.js';

const per = (o: Partial<LabelCore> = {}): LabelCore => ({ ...zeroLabelCore(), ...o });

// A small fixture — offline, no seed file. Includes "ice cream" to prove the
// matcher won't pull "cream" into a spelling-neighbor it shouldn't.
const FOODS: Food[] = [
  { name: 'eggplant', aliases: ['aubergine'], per100g: per({ calories: 25 }), portions: [{ unit: 'count', grams: 458 }] },
  { name: 'olive oil', aliases: ['extra virgin olive oil'], per100g: per({ calories: 884 }), portions: [{ unit: 'tablespoon', grams: 13.5 }, { unit: 'cup', grams: 216 }] },
  { name: 'tomato', aliases: [], per100g: per({ calories: 18 }), portions: [{ unit: 'count', grams: 123 }] },
  { name: 'garlic', aliases: [], per100g: per({ calories: 149 }), portions: [{ unit: 'count', grams: 3 }] },
  { name: 'heavy cream', aliases: ['heavy whipping cream'], per100g: per({ calories: 340 }), portions: [{ unit: 'cup', grams: 238 }] },
  { name: 'ice cream', aliases: [], per100g: per({ calories: 207 }), portions: [{ unit: 'cup', grams: 132 }] },
  { name: 'flour', aliases: ['all-purpose flour'], per100g: per({ calories: 364 }), portions: [{ unit: 'cup', grams: 125 }] },
  { name: 'water', aliases: [], per100g: per(), portions: [] },
];

const cat = new FoodCatalog(FOODS);

describe('FoodCatalog.matchFood', () => {
  it('matches exact canonical and alias', () => {
    expect(cat.matchFood('garlic')?.name).toBe('garlic');
    expect(cat.matchFood('aubergine')?.name).toBe('eggplant');
    expect(cat.matchFood('heavy whipping cream')?.name).toBe('heavy cream');
  });

  it('matches on head-noun / token-subset after dropping prep words', () => {
    expect(cat.matchFood('extra virgin olive oil')?.name).toBe('olive oil');
    expect(cat.matchFood('finely chopped garlic')?.name).toBe('garlic');
  });

  it('normalizes plurals', () => {
    expect(cat.matchFood('tomatoes')?.name).toBe('tomato');
  });

  it('returns null on a near-miss', () => {
    expect(cat.matchFood('quinoa')).toBeNull();
  });

  it('does NOT match a spelling neighbor: "cream" must not match "ice cream"', () => {
    expect(cat.matchFood('cream')).toBeNull();
  });
});

describe('FoodCatalog.toGrams', () => {
  const flour = cat.matchFood('flour')!;
  const oil = cat.matchFood('olive oil')!;
  const garlic = cat.matchFood('garlic')!;
  const water = cat.matchFood('water')!;

  it('converts weight units directly', () => {
    expect(cat.toGrams(1, 'pound', flour)).toBeCloseTo(453.592);
    expect(cat.toGrams(100, 'gram', flour)).toBe(100);
  });

  it('converts volume via the food\'s own portion', () => {
    expect(cat.toGrams(2, 'cup', flour)).toBe(250);
    expect(cat.toGrams(1, 'tablespoon', oil)).toBe(13.5);
  });

  it('converts a bare count via the count portion', () => {
    expect(cat.toGrams(2, null, garlic)).toBe(6);
  });

  it('falls back to water density only for water-like liquids', () => {
    expect(cat.toGrams(1, 'cup', water)).toBeCloseTo(236.6);
  });

  it('returns null for a dry-goods volume with no portion (never a water guess)', () => {
    const dry: Food = { name: 'mystery powder', aliases: [], per100g: per(), portions: [] };
    expect(cat.toGrams(1, 'cup', dry)).toBeNull();
  });
});
