import { defineConfig } from 'drizzle-kit';

// SQLite dialect → drizzle-kit emits SQLite DDL for libSQL/Turso. The generated
// .sql is applied with scripts/apply-schema.mjs over @libsql/client.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
});
