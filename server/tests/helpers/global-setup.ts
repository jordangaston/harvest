import { Client } from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import { ensureDatabases, LOCAL_ADMIN_URL } from '../../scripts/create-databases.js';

const testDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/harvest';

const dbosSystemUrl =
  process.env.DBOS_SYSTEM_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/harvest_dbos';

// Once before the suite: ensure the local test DBs exist, reset the app DB's
// public schema and the DBOS system DB's `dbos` schema (so every run starts with
// a clean workflow ledger), and apply migrations.
export async function setup(): Promise<void> {
  await ensureDatabases(LOCAL_ADMIN_URL);
  await resetPublicSchema(testDatabaseUrl);
  await dropDbosSchema(dbosSystemUrl);
  await runMigrations(testDatabaseUrl);
}

async function dropDbosSchema(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS dbos CASCADE');
  } finally {
    await client.end();
  }
}

async function resetPublicSchema(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    // Drop the migration ledger so migrate re-applies from scratch.
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  } finally {
    await client.end();
  }
}
