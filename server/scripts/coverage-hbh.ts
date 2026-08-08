/**
 * C5a REAL-coverage check (live) — fetch real halfbakedharvest.com recipes through
 * the actual import parse path (WebsiteFetcher schema.org JSON-LD), run each
 * ingredient through the food catalog, and report per-recipe coverage + whether
 * nutrition clears the ≥0.6 floor. Live network (this is verification, not a test).
 *
 * Run: tsx scripts/coverage-hbh.ts <urls-file> [limit]
 */
import { readFileSync } from 'node:fs';
import { WebsiteFetcher } from '../src/fetch/website.js';
import { parseIngredientLine } from '../src/parse/ingredient.js';
import { FoodCatalog } from '../src/nutrition/food-catalog.js';
import { NutritionService } from '../src/services/nutrition-service.js';

const catalog = FoodCatalog.create();
const nutrition = new NutritionService(catalog);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main(): Promise<void> {
  const [urlsFile, limitArg] = process.argv.slice(2);
  const limit = Number(limitArg) || 20;
  const urls = readFileSync(urlsFile, 'utf8').trim().split('\n').filter(Boolean);

  const rows: { name: string; total: number; covered: number; rate: number; computed: boolean; kcal: string | null }[] = [];
  for (const url of urls) {
    if (rows.length >= limit) break;
    let recipe;
    try {
      recipe = await WebsiteFetcher.create().fetch(url);
    } catch (err) {
      console.log(`SKIP  ${url} — ${(err as Error).message.slice(0, 60)}`);
      continue;
    }
    if (recipe.ingredients.length < 4) {
      console.log(`SKIP  ${url} — only ${recipe.ingredients.length} ingredients (not a dish)`);
      continue;
    }
    const ings = recipe.ingredients.map(parseIngredientLine);
    let covered = 0;
    for (const ing of ings) {
      const food = ing.amount != null ? catalog.matchFood(ing.name) : null;
      if (food && catalog.toGrams(Number(ing.amount), ing.unit, food) != null) covered++;
    }
    const servings = recipe.servings ? parseInt(recipe.servings, 10) || 4 : 4;
    const result = nutrition.compute(ings, servings);
    const rate = covered / ings.length;
    rows.push({
      name: recipe.title || url.split('/').filter(Boolean).pop()!,
      total: ings.length,
      covered,
      rate,
      computed: Boolean(result),
      kcal: result ? result.values.calories : null,
    });
  }

  console.log('\n=== Per-recipe coverage (real halfbakedharvest.com recipes) ===');
  for (const r of rows) {
    console.log(
      `${r.computed ? 'COMPUTE' : ' null  '} ${(r.rate * 100).toFixed(0).padStart(3)}%  ` +
        `${String(r.covered).padStart(2)}/${String(r.total).padStart(2)}  ` +
        `${r.kcal ? (r.kcal + ' kcal/srv').padStart(14) : ''.padStart(14)}  ${r.name}`,
    );
  }
  const computed = rows.filter((r) => r.computed).length;
  const rates = rows.map((r) => r.rate * 100);
  console.log('\n=== Aggregate ===');
  console.log(`recipes evaluated: ${rows.length}`);
  console.log(`nutrition computes (clears ≥0.6 floor): ${computed}/${rows.length}`);
  console.log(`returns null (below floor): ${rows.length - computed}/${rows.length}`);
  console.log(`median coverage: ${median(rates).toFixed(0)}%`);
  console.log(`mean coverage: ${(rates.reduce((a, b) => a + b, 0) / (rates.length || 1)).toFixed(0)}%`);
}

main();
