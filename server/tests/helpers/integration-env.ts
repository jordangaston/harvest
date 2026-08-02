/**
 * Shared connection strings for the integration project. Defaults target the
 * local Postgres (harvest / harvest_dbos); override via env for CI. Reading
 * these also sets process.env so app modules (env.ts, the DBOS data source)
 * see the same values when imported inside the test process.
 */
export const PG_ADMIN_URL =
  process.env.PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/harvest';

export const TEST_DBOS_SYSTEM_URL =
  process.env.DBOS_SYSTEM_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/harvest_dbos';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DBOS_SYSTEM_DATABASE_URL = TEST_DBOS_SYSTEM_URL;
