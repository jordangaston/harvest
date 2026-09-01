import { describe, it, expect } from 'vitest';
import { renderRecipePage } from '../src/recipe-page.js';
import type { PublicRecipe } from '../src/models/recipe.js';

/** A minimal public recipe with an XSS-shaped title to exercise escaping. */
function recipe(overrides: Partial<PublicRecipe> = {}): PublicRecipe {
  return {
    id: 'r1',
    title: 'Miso <b>Salmon</b>',
    source_type: 'tiktok',
    servings: 2,
    servings_estimated: false,
    total_minutes: 25,
    image_url: 'https://img.example/s.jpg',
    ingredients: [{ name: 'salmon', quantity_text: '2 fillets' }, { name: 'miso' }],
    steps: ['Marinate the fish', 'Broil 8 min'],
    cost_per_serving_cents: null,
    cost_coverage: null,
    categories: { cuisine: [], meal_type: [], dish_type: [], primary_ingredient: [] },
    diets: [],
    ...overrides,
  };
}

describe('renderRecipePage', () => {
  it('renders title, meta, ingredients (with quantity) and numbered steps', () => {
    const html = renderRecipePage(recipe(), 'https://harvest.example');
    expect(html).toContain('2 servings');
    expect(html).toContain('25 min');
    expect(html).toContain('2 fillets');
    expect(html).toContain('salmon');
    expect(html).toContain('Broil 8 min');
    expect(html).toContain('og:url" content="https://harvest.example/r/r1"');
  });

  it('escapes user-imported text — no raw markup from the title reaches the page', () => {
    const html = renderRecipePage(recipe());
    expect(html).not.toContain('<b>Salmon</b>');
    expect(html).toContain('Miso &lt;b&gt;Salmon&lt;/b&gt;');
  });

  it('no image → the emoji placeholder, no <img>', () => {
    const html = renderRecipePage(recipe({ image_url: undefined }));
    expect(html).toContain('🍽️');
    expect(html).not.toContain('<img');
  });
});
