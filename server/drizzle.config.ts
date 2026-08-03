import { defineConfig } from 'drizzle-kit';

const url =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/harvest';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
