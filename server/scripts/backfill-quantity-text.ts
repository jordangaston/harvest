import 'dotenv/config';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { makeDb } from '../src/db.js';
import { ingredients } from '../src/schema.js';
import { parseIngredientLine } from '../src/parse/ingredient.js';

/**
 * One-off: recompute `ingredients.quantity_text` to the measurement-only form. Rows seeded
 * before the parser fix stored the WHOLE raw line there, so the recipe UI (which shows
 * `quantity_text` then `name`) repeated the name. Re-parsing the stored line reproduces
 * exactly what a fresh parse yields — deterministic, no LLM. Idempotent: re-parsing an
 * already-measurement value leaves it unchanged.
 */
async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('Usage: TURSO_DATABASE_URL=… tsx scripts/backfill-quantity-text.ts');
    process.exit(1);
  }
  const db = makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));

  const rows = await db.select({ id: ingredients.id, quantityText: ingredients.quantityText }).from(ingredients);
  let changed = 0;
  for (const row of rows) {
    if (!row.quantityText) continue;
    const measure = parseIngredientLine(row.quantityText).quantityText;
    if (measure !== row.quantityText) {
      await db.update(ingredients).set({ quantityText: measure }).where(eq(ingredients.id, row.id));
      changed++;
    }
  }
  console.log(`scanned=${rows.length} updated=${changed}`);
}

await main();
