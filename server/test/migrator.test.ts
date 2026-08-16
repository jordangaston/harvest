import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/**
 * Proves the drizzle migrator applies EVERY journal migration in order (not just
 * the first .sql) and tracks each in __drizzle_migrations — the exact guarantee
 * the old first-.sql snapshot applier broke. Two migrations point at a temp
 * folder: 0000 creates table `a`, 0001 creates table `b`.
 */
let dir: string;
let migrationsFolder: string;
let client: Client;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harvest-migrator-"));
  migrationsFolder = join(dir, "migrations");
  mkdirSync(join(migrationsFolder, "meta"), { recursive: true });

  writeFileSync(join(migrationsFolder, "0000_base.sql"), "CREATE TABLE `a` (`id` integer PRIMARY KEY);");
  writeFileSync(join(migrationsFolder, "0001_second.sql"), "CREATE TABLE `b` (`id` integer PRIMARY KEY);");
  writeFileSync(
    join(migrationsFolder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "6", when: 1, tag: "0000_base", breakpoints: true },
        { idx: 1, version: "6", when: 2, tag: "0001_second", breakpoints: true },
      ],
    }),
  );

  client = createClient({ url: `file:${join(dir, "t.db")}` });
});

afterEach(() => {
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("drizzle migrator", () => {
  it("applies BOTH migrations in order and tracks 2 rows in __drizzle_migrations", async () => {
    await migrate(drizzle(client), { migrationsFolder });

    const objects = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b') ORDER BY name",
    );
    // The SECOND migration's table exists — the first-.sql applier would have missed it.
    expect(objects.rows.map((r) => r.name)).toEqual(["a", "b"]);

    const tracked = await client.execute("SELECT COUNT(*) AS n FROM __drizzle_migrations");
    expect(Number(tracked.rows[0].n)).toBe(2);
  });
});
