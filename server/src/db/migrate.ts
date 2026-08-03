import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Applies pending Drizzle migrations to `url`. The CLI uses `drizzle-kit migrate`
 * (npm run migrate); this helper exists for the integration harness, which
 * migrates a fresh per-run test database programmatically. Idempotent — Drizzle
 * skips already-applied migrations.
 */
export async function runMigrations(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
