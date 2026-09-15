import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { backfillCourseFacet } from '../src/categorize/backfill-course-facet.js';

/**
 * Course/form split data move: re-tags existing `recipe_categories(facet='dish_type')` role rows
 * (appetizer/main_course/side_dish/dessert) to the new `course` facet. Idempotent — a re-run moves
 * nothing. Run once against Turso after deploying the split. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const { rowsMoved } = await backfillCourseFacet(db);
console.log(`Done. rows_moved=${rowsMoved}`);
process.exit(0);
