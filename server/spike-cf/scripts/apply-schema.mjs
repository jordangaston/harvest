// Apply the generated SQLite DDL to a libSQL target. Works for both a local
// `file:` database and a `turso dev` / Turso-cloud HTTP URL — the node
// @libsql/client speaks all of them. Replaces the old `wrangler d1 execute`.
//
//   TURSO_DATABASE_URL=file:local.db          node scripts/apply-schema.mjs   (default)
//   TURSO_DATABASE_URL=http://127.0.0.1:8080  node scripts/apply-schema.mjs   (turso dev)
import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

const sqlFile = readdirSync('drizzle').find((f) => f.endsWith('.sql'));
if (!sqlFile) {
  console.error('no drizzle/*.sql — run `npm run db:generate` first');
  process.exit(1);
}

const ddl = readFileSync(`drizzle/${sqlFile}`, 'utf8');
const client = createClient({ url, authToken });
// executeMultiple runs the whole `;`-separated script; drizzle's
// `--> statement-breakpoint` lines are SQL comments.
await client.executeMultiple(ddl);
console.log(`applied ${sqlFile} to ${url}`);
