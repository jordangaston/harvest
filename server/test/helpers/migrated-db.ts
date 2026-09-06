import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { makeDb, type Database } from "../../src/db.js";

const DRIZZLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

/**
 * Builds a fresh throwaway `file:` libSQL db and applies ALL journal migrations in
 * order via the drizzle migrator (tracked in __drizzle_migrations) — the same
 * migrate() path a Turso deploy runs. A file (not `:memory:`, which is
 * connection-private) is required so an interactive transaction's connection
 * shares the schema.
 * @returns the raw client, the Drizzle db, and a cleanup() to drop the temp dir.
 */
export async function migratedFileDb(): Promise<{ client: Client; db: Database; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "harvest-libsql-"));
  const client = createClient({ url: `file:${join(dir, "t.db")}` });
  const db = makeDb(client);
  await migrate(db, { migrationsFolder: DRIZZLE_DIR });
  return {
    client,
    db,
    cleanup: () => {
      client.close(); // leaked clients exhaust the worker's fds — the ConnectionFailed(:14) "flake"
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
