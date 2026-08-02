import { Client } from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import { TEST_DATABASE_URL, TEST_DBOS_SYSTEM_URL, PG_ADMIN_URL } from './integration-env.js';

/**
 * Vitest global setup for the integration project. Ensures the local test
 * databases exist, resets the app database's public schema to a clean slate,
 * and applies all Drizzle migrations. Runs once before any integration spec.
 */
export async function setup(): Promise<void> {
  await ensureDatabases();
  await resetPublicSchema(TEST_DATABASE_URL);
  await runMigrations(TEST_DATABASE_URL);
}

async function ensureDatabases(): Promise<void> {
  const admin = new Client({ connectionString: PG_ADMIN_URL });
  await admin.connect();
  try {
    for (const name of ['harvest', 'harvest_dbos']) {
      try {
        await admin.query(`CREATE DATABASE "${name}"`);
      } catch (err) {
        if (!(err instanceof Error && 'code' in err && err.code === '42P04')) throw err;
      }
    }
  } finally {
    await admin.end();
  }
}

async function resetPublicSchema(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    // Drop the Drizzle migration ledger too, so migrate re-applies from scratch
    // (otherwise it thinks 0000 is already applied and skips creating tables).
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS dbos CASCADE');
  } finally {
    await client.end();
  }
}

void TEST_DBOS_SYSTEM_URL;
