import { describe, it, expect } from 'vitest';
import { isStandaloneMeal, wantsMainsOnly } from '../src/ranking/course.js';
import type { RankableRecipe } from '../src/ranking/types.js';

const rec = (dishType: string[]) =>
  ({ categories: { cuisine: [], dishType, primaryIngredient: [] } }) as unknown as RankableRecipe;

describe('isStandaloneMeal', () => {
  it('keeps mains', () => {
    for (const d of ['main_course', 'pasta', 'soup', 'salad', 'taco', 'bowl']) {
      expect(isStandaloneMeal(rec([d])), d).toBe(true);
    }
  });
  it('drops side/bread/dessert/drink-only', () => {
    for (const d of ['bread', 'side_dish', 'dessert', 'cookie', 'beverage', 'sauce']) {
      expect(isStandaloneMeal(rec([d])), d).toBe(false);
    }
  });
  it('keeps a recipe that is also a main (soup + bread)', () => {
    expect(isStandaloneMeal(rec(['soup', 'bread']))).toBe(true);
  });
  it('keeps unknown dish type (no over-filtering)', () => {
    expect(isStandaloneMeal(rec([]))).toBe(true);
  });
});

describe('wantsMainsOnly', () => {
  it('true for full-meal contexts', () => {
    expect(wantsMainsOnly(['lunch', 'dinner'])).toBe(true);
    expect(wantsMainsOnly(['dinner'])).toBe(true);
  });
  it('false when snacks are wanted or show-all', () => {
    expect(wantsMainsOnly(['lunch', 'snack'])).toBe(false);
    expect(wantsMainsOnly([])).toBe(false);
  });
});
