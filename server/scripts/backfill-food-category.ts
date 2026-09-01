import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { backfillFoodCategory } from '../src/diet/backfill-food-category.js';

/**
 * Food-category backfill: re-runs the DietClassifier over every existing recipe and persists its
 * food classes as `recipe_categories(facet='food_category')` rows, so the live corpus is
 * moderatable on day one (without it, only newly-imported recipes tag and moderation silently
 * under-applies). Reuses the ingest classifier (offline FDC match, no network/LLM). Idempotent:
 * `onConflictDoNothing` on the composite PK means a re-run writes no duplicates. Logs coverage.
 * Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const { recipes, rowsWritten } = await backfillFoodCategory(db);
console.log(`Done. recipes=${recipes} rows_written=${rowsWritten}`);
process.exit(0);
