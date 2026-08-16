import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

// Turso dialect → drizzle-kit generates SQLite-compatible DDL and `drizzle-kit
// migrate` applies every pending migration to the libSQL/Turso target in journal
// order, tracked via __drizzle_migrations. Creds come from .env.local (dotenv).
export default defineConfig({
  dialect: "turso",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
