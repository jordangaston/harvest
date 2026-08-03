import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

// Creates the local dev/test databases on the admin URL. Prod uses Neon and
// never runs this. Tolerates already-exists (Postgres 42P04).
export const LOCAL_ADMIN_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
export const LOCAL_DATABASES = ['harvest'];

export async function ensureDatabases(adminUrl: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const name of LOCAL_DATABASES) {
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
