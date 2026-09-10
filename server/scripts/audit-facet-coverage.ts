import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { auditFacetCoverage } from '../src/categorize/audit-facet-coverage.js';

/**
 * Facet-coverage audit (read-only): reports how many recipes carry `cuisine` / `dish_type` / both
 * — `both` is the Tier 1 eligibility ceiling — and prints the gap id lists. Run before the backfill
 * to size the gap. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const c = await auditFacetCoverage(db);
const pct = (n: number) => (c.total === 0 ? '—' : `${Math.round((n / c.total) * 100)}%`);
console.log(`total=${c.total}`);
console.log(`cuisine=${c.withCuisine} (${pct(c.withCuisine)})  dish_type=${c.withDishType} (${pct(c.withDishType)})  both=${c.withBoth} (${pct(c.withBoth)})  ← Tier 1 ceiling`);
console.log(`gap_cuisine=${c.gapCuisine.length}  gap_dish_type=${c.gapDishType.length}`);
if (c.gapCuisine.length) console.log(`missing cuisine: ${c.gapCuisine.join(', ')}`);
if (c.gapDishType.length) console.log(`missing dish_type: ${c.gapDishType.join(', ')}`);
process.exit(0);
