import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { backfillHeartbeats } from '../src/crons/backfill-heartbeats.js';

/**
 * Heartbeat lifecycle backfill (WI-03 AC-3): seeds a live `thread_heartbeat` row for every thread
 * that already has an active objective, so the sweep beats for pre-existing threads on day one.
 * Idempotent — a re-run leaves already-live rows untouched. Target DB from `TURSO_DATABASE_URL`.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const { created, resumed, skipped } = await backfillHeartbeats(db);
console.log(`Done. created=${created} resumed=${resumed} skipped=${skipped}`);
process.exit(0);
