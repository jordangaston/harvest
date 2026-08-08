/**
 * C5 parsed-path coverage — how many real recipes publish schema.org
 * NutritionInformation (the only nutrition source we keep after punting compute).
 * Run: tsx scripts/coverage-parsed.ts <urls-file> [limit]
 */
import { readFileSync } from 'node:fs';
import { WebsiteFetcher } from '../src/fetch/website.js';

async function main(): Promise<void> {
  const [urlsFile, limitArg] = process.argv.slice(2);
  const limit = Number(limitArg) || 20;
  const urls = readFileSync(urlsFile, 'utf8').trim().split('\n').filter(Boolean);

  const rows: { name: string; parsed: boolean; calories: string | null }[] = [];
  for (const url of urls) {
    if (rows.length >= limit) break;
    let recipe;
    try {
      recipe = await WebsiteFetcher.create().fetch(url);
    } catch {
      continue;
    }
    if (recipe.ingredients.length < 4) continue;
    rows.push({ name: recipe.title || url, parsed: Boolean(recipe.nutrition), calories: recipe.nutrition?.calories ?? null });
  }

  console.log('\n=== C5 parsed-path coverage (real halfbakedharvest.com recipes) ===');
  for (const r of rows) {
    console.log(`${r.parsed ? 'PARSED ' : ' null  '} ${r.calories ? (r.calories + ' kcal').padStart(12) : ''.padStart(12)}  ${r.name}`);
  }
  const parsed = rows.filter((r) => r.parsed).length;
  console.log('\n=== Aggregate ===');
  console.log(`recipes evaluated: ${rows.length}`);
  console.log(`publish schema.org NutritionInformation (nutrition_source='parsed'): ${parsed}/${rows.length}`);
  console.log(`no published nutrition (stored null): ${rows.length - parsed}/${rows.length}`);
}

main();
