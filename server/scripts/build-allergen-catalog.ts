import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { seedAllergenCatalog } from '../src/allergen/allergen-catalog.js';

/**
 * Seeds `fdc_food_allergen` from the already-seeded `fdc_foods` (offline, run once against
 * the target Turso DB *after* `build-fdc-catalog.ts`). Idempotent (`ON CONFLICT DO NOTHING`),
 * so re-runs — e.g. after editing the catalog config — are safe.
 */
async function main(): Promise<void> {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const n = await seedAllergenCatalog(makeDb(client));
  process.stdout.write(`seeded ${n} allergen rows → fdc_food_allergen\n`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) await main();
