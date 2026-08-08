/**
 * C5a coverage check — run the real food catalog against representative recipes and
 * report per-recipe match rate + whether nutrition clears the ≥0.6 floor (computes).
 * Run: tsx scripts/coverage-report.ts
 */
import { parseIngredientLine } from '../src/parse/ingredient.js';
import { FoodCatalog } from '../src/nutrition/food-catalog.js';
import { NutritionService } from '../src/services/nutrition-service.js';

const RECIPES: [name: string, ingredients: string[]][] = [
  ['Creamy Garlic Chicken', [
    '2 chicken breasts', '4 cloves garlic, minced', '1 cup heavy cream', '2 tbsp butter',
    '1 cup parmesan cheese', '1 tbsp olive oil', '1 tsp salt', '1/2 tsp black pepper', '1 cup chicken broth',
  ]],
  ['Spaghetti Bolognese', [
    '1 lb ground beef', '1 onion, diced', '2 cloves garlic', '1 carrot', '1 celery stalk',
    '2 cups canned tomatoes', '2 tbsp tomato paste', '400 g spaghetti', '2 tbsp olive oil', '1 tsp salt',
  ]],
  ['Chocolate Chip Cookies', [
    '2 cups all-purpose flour', '1 cup butter', '1 cup brown sugar', '1/2 cup granulated sugar',
    '2 eggs', '1 tsp vanilla extract', '1 tsp baking soda', '1/2 tsp salt', '2 cups chocolate chips',
  ]],
  ['Veggie Stir Fry', [
    '2 tbsp soy sauce', '1 tbsp sesame oil', '1 bell pepper', '1 cup broccoli', '1 carrot',
    '1 onion', '2 cloves garlic', '1 tbsp ginger', '1 cup rice', '1 tbsp vegetable oil',
  ]],
  ['Greek Salad', [
    '3 tomatoes', '1 cucumber', '1 red onion', '1 cup feta cheese', '1/2 cup olives',
    '2 tbsp olive oil', '1 tbsp red wine vinegar', '1 tsp oregano', '1/2 tsp salt',
  ]],
];

const catalog = FoodCatalog.create();
const nutrition = new NutritionService(catalog);

let cleared = 0;
for (const [name, lines] of RECIPES) {
  const ings = lines.map(parseIngredientLine);
  const misses: string[] = [];
  let matched = 0;
  for (const ing of ings) {
    if (catalog.matchFood(ing.name)) matched++;
    else misses.push(ing.name);
  }
  const rate = matched / ings.length;
  const computed = nutrition.compute(ings, 4);
  if (computed) cleared++;
  console.log(`\n${name}`);
  console.log(`  matched ${matched}/${ings.length} (${(rate * 100).toFixed(0)}%) — floor 0.6 ${rate >= 0.6 ? 'CLEARED' : 'below'}`);
  console.log(`  nutrition: ${computed ? `computed (${computed.values.calories} kcal/serving)` : 'null'}`);
  if (misses.length) console.log(`  unmatched: ${misses.join(', ')}`);
}
console.log(`\n${RECIPES.length} recipes · ${cleared} compute nutrition (clear the 0.6 floor).`);
