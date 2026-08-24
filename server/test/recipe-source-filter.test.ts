import { describe, it, expect } from 'vitest';
import { isRecipeSource } from '../src/parse/recipe-source-filter.js';

describe('isRecipeSource', () => {
  const recipes = [
    { url: 'https://www.halfbakedharvest.com/gochujang-butter-pasta', title: 'Gochujang Butter Pasta' },
    { url: 'https://www.halfbakedharvest.com/spiced-honey-bourbon-old-fashioned', title: 'Spiced Honey Bourbon Old Fashioned' },
    { url: 'https://www.halfbakedharvest.com/dark-chocolate-banana-bark', title: 'Dark Chocolate Banana Bark' },
  ];
  const nonRecipes = [
    { url: 'https://www.halfbakedharvest.com/30-deliciously-popular-mexican-recipes', title: '30 Deliciously Popular Mexican Recipes.' },
    { url: 'https://www.halfbakedharvest.com/meet-tieghan', title: 'About Me' },
    { url: 'https://www.halfbakedharvest.com/pantry', title: 'Pantry' },
    { url: 'https://www.halfbakedharvest.com/my-favorite-healthy-recipes-for-2025', title: 'My Favorite Healthy Recipes' },
    { url: 'https://www.halfbakedharvest.com/recipe-collections', title: 'Recipe Collections' },
  ];

  it('keeps single recipes', () => {
    for (const r of recipes) expect(isRecipeSource(r), r.url).toBe(true);
  });
  it('drops roundups, guides, and about/index pages', () => {
    for (const r of nonRecipes) expect(isRecipeSource(r), r.url).toBe(false);
  });
});
