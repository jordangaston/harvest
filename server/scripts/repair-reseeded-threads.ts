import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createClient } from '@libsql/client';
import { makeDb } from '../src/db.js';
import { repairReseededThreads } from '../src/chef/repair-reseeded-threads.js';

/**
 * One-off repair for the re-seed bug (chef-steady-state WI-01 AC-6). Deletes onboarding/first_meal_plan
 * objectives (and their tasks, cascade) re-seeded AFTER a thread had already completed onboarding.
 * Idempotent — a re-run deletes nothing. Target DB from TURSO_DATABASE_URL. Repairs dev thread
 * ec79130b's 7775d9be + 42c0be5f.
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const db = makeDb(client);

const deleted = await repairReseededThreads(db);
for (const d of deleted)
  console.log(`thread ${d.threadId}: deleted re-seeded ${d.definition} (${d.status}) ${d.objectiveId} created ${d.createdAt.toISOString()}`);
console.log(`Done. deleted ${deleted.length} re-seeded objective(s).`);
process.exit(0);
