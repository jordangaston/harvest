// Count recipes linked to an import job — the proof's no-restart/no-dup check.
// Runs against whatever TURSO_DATABASE_URL points at (local turso dev or cloud).
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await client.execute({
  sql: 'select count(*) as n from import_job_recipes where import_job_id = ?',
  args: [process.argv[2]],
});
console.log(r.rows[0].n);
