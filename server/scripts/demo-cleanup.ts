/**
 * Cleanup sprint — backend demo. Exercises the real C3 (structured ingredients) and
 * C5 parsed-nutrition modules offline. Run: `npx tsx scripts/demo-cleanup.ts`.
 */
import { parseIngredientLine } from '../src/parse/ingredient.js';
import { WebsiteFetcher } from '../src/fetch/website.js';

function h(title: string) {
  console.log(`\n=== ${title} ===`);
}

// C3 — structured ingredients (minimal deterministic parser).
h('C3 · parseIngredientLine — measurement separated from the display line');
for (const line of ['2 cups flour', '1 lb chicken breast', '1/2 teaspoon salt', '3 large eggs', '2-3 cups broth', '1 tbsp plus 1 tsp butter']) {
  console.log(`${line.padEnd(28)} → ${JSON.stringify(parseIngredientLine(line))}`);
}

// C5 — parsed nutrition from schema.org NutritionInformation (the only nutrition
// source we keep; computing from a food catalog was punted).
h('C5 · parsed nutrition from schema.org NutritionInformation');
const html = `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Recipe', name: 'X', recipeIngredient: ['1 cup flour'], recipeInstructions: ['Bake'],
  nutrition: { '@type': 'NutritionInformation', calories: '250 calories', proteinContent: '8 g', fatContent: '9 g', carbohydrateContent: '30 g', fiberContent: '2 g', sugarContent: '5 g', saturatedFatContent: '3 g', sodiumContent: '150 mg' },
})}</script>`;
console.log('parsed:', JSON.stringify(WebsiteFetcher.parse(html).nutrition));
console.log('  → stored with nutrition_source = "parsed"; a source without a block stores null.');

console.log('\nOK — C3 + C5 (parsed) demonstrated on real code, offline.');
