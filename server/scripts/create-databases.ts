import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Creates the local databases used for development and tests: `harvest`
 * (DATABASE_URL) and `harvest_dbos` (DBOS_SYSTEM_DATABASE_URL). Connects to the
 * server's default `postgres` maintenance database. Tolerates databases that
 * already exist (Postgres error code 42P04). Prod/staging use Neon and never
 * run this script.
 */
export const LOCAL_ADMIN_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
export const LOCAL_DATABASES = ['harvest', 'harvest_dbos'];

/** Creates each database, tolerating any that already exist (42P04). */
export async function ensureDatabases(
  adminUrl: string,
  names: readonly string[] = LOCAL_DATABASES,
): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const name of names) {
      try {
        await client.query(`CREATE DATABASE "${name}"`);
        process.stdout.write(`created database ${name}\n`);
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === '42P04') {
          process.stdout.write(`database ${name} already exists\n`);
          continue;
        }
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  ensureDatabases(process.env.PG_ADMIN_URL ?? LOCAL_ADMIN_URL).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
