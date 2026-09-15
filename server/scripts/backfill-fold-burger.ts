import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { foldBurgerToSandwich } from '../src/categorize/backfill-fold-burger.js';

/**
 * Vocab fold "a burger is a sandwich": re-tags existing `dish_type='burger'` rows to `sandwich`
 * (deduping recipes that already carry `sandwich`). Idempotent. Run once against Turso after the
 * vocab change deploys. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const { folded, deduped } = await foldBurgerToSandwich(db);
console.log(`Done. folded=${folded} deduped=${deduped}`);
process.exit(0);
