/**
 * Cleanup sprint — backend demo. Exercises the real C3/C5/C5a modules end to end
 * (offline: the committed food catalog + pure parsers). Run: `npx tsx scripts/demo-cleanup.ts`.
 */
import { parseIngredientLine } from '../src/parse/ingredient.js';
import { FoodCatalog } from '../src/nutrition/food-catalog.js';
import { NutritionService } from '../src/services/nutrition-service.js';
import { WebsiteFetcher } from '../src/fetch/website.js';

function h(title: string) {
  console.log(`\n=== ${title} ===`);
}

// C3 — structured ingredients (minimal deterministic parser).
h('C3 · parseIngredientLine — measurement separated from the display line');
for (const line of ['2 cups flour', '1 lb chicken breast', '1/2 teaspoon salt', '3 large eggs', '1 tbsp plus 1 tsp butter', '6-8 chicken wings']) {
  console.log(`${line.padEnd(28)} → ${JSON.stringify(parseIngredientLine(line))}`);
}

// C5a — the in-memory catalog + matcher + unit→grams.
h('C5a · FoodCatalog.matchFood (lexical + alias + Dice≥0.8, NOT embeddings)');
const catalog = FoodCatalog.create();
for (const name of ['heavy whipping cream', 'extra virgin olive oil', 'finely chopped garlic', 'tomatoes', 'cream', 'quinoa']) {
  const food = catalog.matchFood(name);
  console.log(`${name.padEnd(24)} → ${food ? food.name : 'null (unmatched — logged)'}`);
}
h('C5a · toGrams — weight direct / volume via portion / water-like fallback');
const flour = catalog.matchFood('flour')!;
const water = catalog.matchFood('water')!;
console.log(`2 cup flour   → ${catalog.toGrams(2, 'cup', flour)} g`);
console.log(`1 pound flour → ${catalog.toGrams(1, 'pound', flour)} g`);
console.log(`1 cup water   → ${catalog.toGrams(1, 'cup', water)} g (water-like fallback)`);

// C5 — computed nutrition (coverage floor ≥ 0.6) and parsed nutrition.
h('C5 · NutritionService.compute — per-serving label core (computed)');
const nutrition = NutritionService.create();
const recipe = [
  parseIngredientLine('2 chicken breasts'),
  parseIngredientLine('4 cloves garlic, minced'),
  parseIngredientLine('1 cup heavy cream'),
];
console.log('ingredients:', recipe.map((i) => i.name));
console.log('computed (servings 4):', JSON.stringify(nutrition.compute(recipe, 4)));
console.log('below floor (1 real + 2 unknown):', JSON.stringify(nutrition.compute([parseIngredientLine('1 cup heavy cream'), parseIngredientLine('1 cup xyzzy'), parseIngredientLine('1 cup blorp')], 4)));

h('C5 · parsed nutrition from schema.org NutritionInformation');
const html = `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Recipe', name: 'X', recipeIngredient: ['1 cup flour'], recipeInstructions: ['Bake'],
  nutrition: { '@type': 'NutritionInformation', calories: '250 calories', proteinContent: '8 g', fatContent: '9 g', carbohydrateContent: '30 g', fiberContent: '2 g', sugarContent: '5 g', saturatedFatContent: '3 g', sodiumContent: '150 mg' },
})}</script>`;
console.log('parsed:', JSON.stringify(WebsiteFetcher.parse(html).nutrition));

console.log('\nOK — C3/C5/C5a demonstrated on real code, offline.');
