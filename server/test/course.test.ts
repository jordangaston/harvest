import { describe, it, expect } from 'vitest';
import { isStandaloneMeal, wantsMainsOnly } from '../src/ranking/course.js';
import type { RankableRecipe } from '../src/ranking/types.js';

const rec = (course: string[]) =>
  ({ categories: { cuisine: [], course, dishType: [], primaryIngredient: [] } }) as unknown as RankableRecipe;

describe('isStandaloneMeal', () => {
  it('keeps a main_course', () => {
    expect(isStandaloneMeal(rec(['main_course']))).toBe(true);
  });
  it('drops an appetizer/side/dessert-only recipe', () => {
    for (const c of ['appetizer', 'side_dish', 'dessert']) {
      expect(isStandaloneMeal(rec([c])), c).toBe(false);
    }
  });
  it('keeps a recipe that is also a main (dessert + main_course)', () => {
    expect(isStandaloneMeal(rec(['dessert', 'main_course']))).toBe(true);
  });
  it('keeps an unknown course (no over-filtering on missing data)', () => {
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
