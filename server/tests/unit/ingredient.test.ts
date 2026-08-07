import { describe, it, expect } from 'vitest';
import { parseIngredientLine } from '../../src/parse/ingredient.js';

describe('parseIngredientLine (C3, minimal deterministic)', () => {
  it('separates a leading amount + known unit + name', () => {
    expect(parseIngredientLine('2 cups flour')).toEqual({ name: 'flour', amount: '2', unit: 'cup', quantityText: '2 cups flour' });
    expect(parseIngredientLine('1 lb chicken')).toEqual({ name: 'chicken', amount: '1', unit: 'pound', quantityText: '1 lb chicken' });
    expect(parseIngredientLine('1/2 teaspoon salt')).toEqual({ name: 'salt', amount: '0.5', unit: 'teaspoon', quantityText: '1/2 teaspoon salt' });
    expect(parseIngredientLine('1 1/2 cups sugar')).toEqual({ name: 'sugar', amount: '1.5', unit: 'cup', quantityText: '1 1/2 cups sugar' });
  });

  it('keeps a leading count with no unit (the descriptor rides in the name)', () => {
    expect(parseIngredientLine('3 large eggs')).toEqual({ name: 'large eggs', amount: '3', unit: null, quantityText: '3 large eggs' });
  });

  it('drops a leading "of" after the unit', () => {
    expect(parseIngredientLine('2 cups of whole milk')).toEqual({ name: 'whole milk', amount: '2', unit: 'cup', quantityText: '2 cups of whole milk' });
  });

  it('leaves ambiguous lines unparsed but always preserves the display line (safety guard)', () => {
    for (const raw of ['1 tbsp plus 1 tsp butter', '6-8 chicken wings', 'salt to taste', 'a handful of basil']) {
      const r = parseIngredientLine(raw);
      expect(r.amount).toBeNull();
      expect(r.unit).toBeNull();
      expect(r.quantityText).toBe(raw);
      expect(r.name.length).toBeGreaterThan(0);
    }
  });
});
