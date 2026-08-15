import { defineConfig } from 'drizzle-kit';

// SQLite dialect → drizzle-kit emits SQLite DDL. We apply the generated .sql to
// the local D1 SQLite via `wrangler d1 execute --local` (see package.json). A
// real deploy would use `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
});
