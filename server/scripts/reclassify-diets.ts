import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { eq } from 'drizzle-orm';
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { DietClassifier } from '../src/diet/diet-classifier.js';
import { recipeDiets } from '../src/schema.js';

/**
 * Re-runs the diet classifier over the corpus and rewrites `recipe_diets`. Needed after a
 * classifier fix (e.g. plural seafood names) — stored seed verdicts are otherwise stale.
 * Deterministic (rules + FoodMatcher + macro estimator), no network/LLM. DRYRUN=1 reports
 * vegetarian changes without writing; TITLE=<substr> limits to matching recipes.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const dryRun = process.env.DRYRUN === '1';
const titleFilter = process.env.TITLE;
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);
const classifier = DietClassifier.create(db);

const where = titleFilter ? `where title like '%${titleFilter.replace(/'/g, "''")}%'` : '';
const recRows = (await client.execute(`select id, servings, title from recipes ${where}`)).rows;
console.log(`${recRows.length} recipes${dryRun ? ' (DRY RUN)' : ''}`);

let processed = 0;
let vegChanged = 0;
for (const r of recRows) {
  const rid = String(r.id);
  const servings = r.servings != null ? Number(r.servings) : null;
  const ings = (
    await client.execute({
      sql: 'select name, amount, unit, quantity_text from ingredients where recipe_id = ? order by position',
      args: [rid],
    })
  ).rows.map((i) => ({
    name: String(i.name ?? ''),
    amount: i.amount != null ? String(i.amount) : null,
    unit: i.unit != null ? String(i.unit) : null,
    quantityText: i.quantity_text != null ? String(i.quantity_text) : '',
  }));

  const compat = await classifier.classify(ings, servings);
  processed++;
  if (!compat) continue;

  const prevVeg = (
    await client.execute({ sql: "select verdict from recipe_diets where recipe_id=? and diet_id='vegetarian'", args: [rid] })
  ).rows[0]?.verdict as string | undefined;
  if (prevVeg !== compat.fit.vegetarian) {
    vegChanged++;
    if (titleFilter || dryRun) console.log(`  vegetarian ${prevVeg} → ${compat.fit.vegetarian}  ${r.title}`);
  }

  if (!dryRun) {
    await db.delete(recipeDiets).where(eq(recipeDiets.recipeId, rid));
    const rows = Object.entries(compat.fit).map(([dietId, verdict]) => {
      const b = compat.blockers[dietId] as { kind: string; value: string; class?: string } | undefined;
      return {
        recipeId: rid,
        dietId,
        verdict,
        blockerKind: b?.kind ?? null,
        blockerValue: b?.value ?? null,
        blockerClass: b?.class ?? null,
      };
    });
    if (rows.length) await db.insert(recipeDiets).values(rows as (typeof recipeDiets.$inferInsert)[]);
  }
  if (processed % 500 === 0) console.log(`  ${processed}/${recRows.length} · vegetarian changes ${vegChanged}`);
}
console.log(`Done. processed=${processed} · vegetarian verdict changed for ${vegChanged} recipes`);
process.exit(0);
