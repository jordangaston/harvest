import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { backfillFacets } from '../src/categorize/backfill-facets.js';

/**
 * Facet-coverage backfill: re-runs the categorizer over recipes missing `cuisine`/`dish_type` and
 * writes back only the still-empty facets (never overwriting good rows). Idempotent — re-runnable.
 * Needs `OPENAI_API_KEY` (the original gap cause): without it the analyzer degrades to empty and
 * nothing fills. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set — the backfill would write nothing');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const r = await backfillFacets(db);
console.log(`scanned=${r.scanned} filled=${r.filled} rows_written=${r.rowsWritten} residual=${r.residual.length}`);
if (r.residual.length) console.log(`still uncategorized (excluded from Tier 1): ${r.residual.join(', ')}`);
process.exit(0);
