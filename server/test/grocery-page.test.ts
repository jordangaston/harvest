import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderGroceryPage } from '../src/grocery-page.js';
import type { GroceryItem } from '../src/models/grocery-item.js';
import { RECIPE_CSS_HREF } from '../src/recipe-page.styles.js';
import { makeHarness, type Harness } from './helpers/wave2-harness.js';

/** A grocery row with sensible defaults; override per case. */
function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `i-${Math.random().toString(36).slice(2)}`,
    householdId: 'hh1',
    addedByUserId: null,
    name: 'eggs',
    amount: 12,
    unit: 'count',
    quantityText: null,
    aisle: 'dairy_eggs_fridge',
    icon: 'egg',
    checked: false,
    sourceRecipeId: null,
    position: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('renderGroceryPage', () => {
  it('renders aisle sections in store-walk order, checked items sunk + struck, formatted quantities', () => {
    const html = renderGroceryPage([
      item({ name: 'chicken breast', amount: 2, unit: 'pound', aisle: 'meat_seafood' }),
      item({ name: 'spinach', amount: 1, unit: 'bunch', aisle: 'produce' }),
      item({ name: 'flour', amount: 1.5, unit: 'cup', aisle: 'pantry' }),
      item({ name: 'milk', amount: 1, unit: 'carton', aisle: 'dairy_eggs_fridge', checked: true }),
      item({ name: 'butter', amount: 1, unit: 'stick', aisle: 'dairy_eggs_fridge', position: 1 }),
    ]);
    // Store-walk order: produce before meat before dairy before pantry (labels HTML-escape "&").
    const meat = 'MEAT &amp; SEAFOOD';
    const dairy = 'DAIRY, EGGS &amp; FRIDGE';
    expect(html.indexOf('PRODUCE')).toBeLessThan(html.indexOf(meat));
    expect(html.indexOf(meat)).toBeLessThan(html.indexOf(dairy));
    expect(html.indexOf(dairy)).toBeLessThan(html.indexOf('PANTRY'));
    // Quantities formatted like the grocery tab: fraction glyph + pluralized unit.
    expect(html).toContain('1½ cups');
    expect(html).toContain('2 pounds');
    // Within dairy, the unchecked butter comes before the checked (sunk) milk.
    expect(html.indexOf('butter')).toBeLessThan(html.indexOf('milk'));
    // The checked item is struck through, not hidden.
    expect(html).toContain('milk');
    expect(html).toContain('line-through');
    // Count shown; styled via the shared CSS asset.
    expect(html).toContain('5 items');
    expect(html).toContain(RECIPE_CSS_HREF);
  });

  it('prefers a freeform quantity_text and escapes item names', () => {
    const html = renderGroceryPage([
      item({ name: 'salt <b>x</b>', amount: null, unit: null, quantityText: 'a pinch', aisle: 'herbs_spices' }),
    ]);
    expect(html).toContain('a pinch');
    expect(html).toContain('salt &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('renders the empty state when the list is empty', () => {
    expect(renderGroceryPage([])).toContain('Your list is empty');
  });
});

// TC-3: the @source scan picked up grocery-page.tsx — a class used ONLY by that page is in the
// published asset. A missing @source line would ship the page unstyled (commit 0ebfd7c).
describe('published CSS asset (@source scan)', () => {
  it('contains grocery-page-only utility classes', () => {
    const css = readFileSync(new URL(`../public${RECIPE_CSS_HREF}`, import.meta.url), 'utf8');
    for (const cls of ['line-through', 'items-baseline', 'opacity-60']) {
      expect(css, `expected .${cls} in the built asset — is @source "../src/grocery-page.tsx" present + build:styles run?`).toContain(cls);
    }
  });
});

// AC-1 + TC-1: GET /g/:householdId over the real Hono app + a migrated file db.
let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

describe('GET /g/:householdId', () => {
  it('renders the seeded list with no-store, an unknown household 404s', async () => {
    const { userId } = await h.mintBearer();
    const householdId = await h.seedHousehold(userId);
    const groceries = (await import('../src/services/grocery-service.js')).GroceryService.create(h.db);
    await groceries.add(householdId, [
      { name: 'spinach', amount: 1, unit: 'bunch' },
      { name: 'flour', amount: 1.5, unit: 'cup' },
    ]);

    const res = await h.app.request(`/g/${householdId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('PRODUCE');
    expect(html).toContain('spinach');
    expect(html).toContain('1½ cups');

    const unknown = await h.app.request('/g/00000000-0000-0000-0000-000000000000');
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("couldn't be found");
  });

  it('renders the empty state for a household with no items', async () => {
    const { userId } = await h.mintBearer();
    const householdId = await h.seedHousehold(userId);
    const res = await h.app.request(`/g/${householdId}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Your list is empty');
  });
});
