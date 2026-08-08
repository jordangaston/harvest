import { describe, it, expect } from 'vitest';
import { WebsiteFetcher } from '../../src/fetch/website.js';

/** Build a page with one schema.org Recipe JSON-LD block. */
function pageWith(recipe: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', ...recipe })}</script></head></html>`;
}

describe('WebsiteFetcher.parse — schema.org NutritionInformation (C5 parsed path)', () => {
  it('maps NutritionInformation to the label core, stripping units', () => {
    const html = pageWith({
      name: 'Test',
      recipeIngredient: ['1 cup flour'],
      recipeInstructions: ['Bake'],
      nutrition: {
        '@type': 'NutritionInformation',
        calories: '250 calories',
        fatContent: '9 g',
        saturatedFatContent: '3 g',
        carbohydrateContent: '30 g',
        fiberContent: '2 g',
        sugarContent: '5 g',
        proteinContent: '8 g',
        sodiumContent: '150 mg',
      },
    });

    const recipe = WebsiteFetcher.parse(html);
    expect(recipe.nutrition).toEqual({
      calories: '250',
      grams_of_fat: '9',
      grams_of_saturated_fat: '3',
      grams_of_carbohydrate: '30',
      grams_of_fiber: '2',
      grams_of_sugar: '5',
      grams_of_protein: '8',
      milligrams_of_sodium: '150',
    });
  });

  it('omits nutrition when the block is absent', () => {
    const recipe = WebsiteFetcher.parse(pageWith({ name: 'Test', recipeIngredient: ['1 cup flour'], recipeInstructions: ['Bake'] }));
    expect(recipe.nutrition).toBeUndefined();
  });
});
