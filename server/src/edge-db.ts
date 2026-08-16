import { createClient } from "@libsql/client/web";
import { makeDb, type Database } from "./db.js";

/**
 * Build a Drizzle database for the serverless runtime, reading the Turso
 * connection from the environment. Uses `@libsql/client/web` — the HTTP-only
 * build (no node:fs), so it runs in the Vercel function bundle and opens a client
 * per invocation with no long-lived pool. Local fast tests use the node build
 * with a `file:` URL instead (see test/repositories.test.ts).
 */
export function dbFromEnv(): Database {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return makeDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
}
