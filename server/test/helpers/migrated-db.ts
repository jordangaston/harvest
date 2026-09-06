import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { makeDb, type Database } from "../../src/db.js";

const DRIZZLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

// Migrate ONCE per worker process into a template, then hand each test a file COPY.
// Running the full journal per test was O(migrations × tests) — slow, and libsql leaks
// a few fds per migrate even through close(), which is what kept resurrecting the
// ConnectionFailed(:14) failures as the suite grew.
let templatePromise: Promise<string> | undefined;

function buildTemplate(): Promise<string> {
  return (templatePromise ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "harvest-libsql-template-"));
    const path = join(dir, "t.db");
    const client = createClient({ url: `file:${path}` });
    await migrate(makeDb(client), { migrationsFolder: DRIZZLE_DIR });
    // Fold the WAL into the main file so each copy below is one self-contained db. A
    // copied -shm/-wal pair encodes another process's dead locks — recovering it mostly
    // works but sometimes wedges new connections into SQLite's busy-retry (the
    // minutes-long hangs).
    await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    client.close();
    return path;
  })());
}

/**
 * A fresh throwaway `file:` libSQL db carrying ALL journal migrations (applied once per
 * worker via the same migrate() path a Turso deploy runs, then file-copied per call). A
 * file (not `:memory:`, which is connection-private) is required so an interactive
 * transaction's connection shares the schema.
 * @returns the raw client, the Drizzle db, and a cleanup() to drop the temp dir.
 */
export async function migratedFileDb(): Promise<{ client: Client; db: Database; cleanup: () => void }> {
  const template = await buildTemplate();
  const dir = mkdtempSync(join(tmpdir(), "harvest-libsql-"));
  const path = join(dir, "t.db");
  copyFileSync(template, path);
  const client = createClient({ url: `file:${path}` });
  return {
    client,
    db: makeDb(client),
    cleanup: () => {
      client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
