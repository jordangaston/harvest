import { Client } from 'pg';

/**
 * Creates the local databases used for development and tests: `harvest`
 * (DATABASE_URL) and `harvest_dbos` (DBOS_SYSTEM_DATABASE_URL). Connects to the
 * server's default `postgres` maintenance database. Tolerates databases that
 * already exist (Postgres error code 42P04). Prod/staging use Neon and never
 * run this script.
 */
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';

const DATABASES = ['harvest', 'harvest_dbos'];

async function createDatabase(client: Client, name: string): Promise<void> {
  try {
    await client.query(`CREATE DATABASE "${name}"`);
    process.stdout.write(`created database ${name}\n`);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === '42P04') {
      process.stdout.write(`database ${name} already exists\n`);
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    for (const name of DATABASES) {
      await createDatabase(client, name);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
