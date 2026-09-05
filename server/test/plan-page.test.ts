import { describe, it, expect } from 'vitest';
import { renderPlanPage } from '../src/plan-page.js';
import type { MealPlanEntryView } from '../src/models/meal-plan.js';

function entry(overrides: Partial<MealPlanEntryView> = {}): MealPlanEntryView {
  return {
    id: 'e1',
    date: '2026-09-07',
    meal: 'dinner',
    position: 0,
    source: 'generated',
    recipe: { id: 'r1', title: 'Chicken <b>Tinga</b> Tacos', image_url: 'https://img.example/t.jpg' },
    ...overrides,
  };
}

describe('renderPlanPage', () => {
  it('renders dinners before lunches, day labels, escaped titles, sides as "with", and /r/ links', () => {
    const html = renderPlanPage(
      [
        entry({ id: 'e3', date: '2026-09-07', meal: 'lunch', recipe: { id: 'r3', title: 'Big Salad' } }),
        entry(),
        entry({ id: 'e2', position: 1, recipe: { id: 'r2', title: 'Elote Corn' } }),
      ],
      'https://harvest.example',
    );
    expect(html.indexOf('Dinners')).toBeLessThan(html.indexOf('Lunches'));
    expect(html).toContain('Monday · Sep 7');
    expect(html).toContain('Chicken &lt;b&gt;Tinga&lt;/b&gt; Tacos'); // escaped, not injected
    expect(html).toContain('with '); // the position-1 side reads as an accompaniment
    expect(html).toContain('https://harvest.example/r/r1');
    expect(html).toContain('https://harvest.example/r/r2');
  });

  it('renders the empty state when nothing is planned', () => {
    expect(renderPlanPage([], 'https://harvest.example')).toContain('No meals planned yet');
  });
});
