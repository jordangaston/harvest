import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { makeDb, type Database } from '../src/db.js';
import { cuisines } from '../src/schema.js';
import { CUISINES } from '../src/categorize/cuisines.js';

/**
 * Seeds the `cuisines` table from the authored `cuisines-data.ts` (via the shared
 * CUISINES module, so VOCAB and this table never drift). Idempotent: upserts by slug,
 * so a re-run refreshes labels/parents without duplicating rows. Rows are inserted in
 * file order (parents before children) so the `parent_slug` self-FK holds.
 *
 * Run AFTER `seed:reference` in a deploy; independent of it otherwise. Needs
 * `TURSO_DATABASE_URL` (the `turso dev` URL for local, or the Turso DB).
 */
export async function seedCuisines(db: Database): Promise<number> {
  for (const c of CUISINES) {
    await db
      .insert(cuisines)
      .values({ slug: c.slug, label: c.label, parentSlug: c.parent_slug })
      .onConflictDoUpdate({ target: cuisines.slug, set: { label: c.label, parentSlug: c.parent_slug } });
  }
  return CUISINES.length;
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL is required (e.g. the `turso dev` URL, or the Turso DB).');
    process.exit(1);
  }
  const db = makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  const n = await seedCuisines(db);
  console.log(`✓ cuisines → ${n} rows (cuisines table, upserted by slug)`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) await main();
