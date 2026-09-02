import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("food-moderation migration is additive (AC 10 / Test Case 9)", () => {
  const DRIZZLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

  it("a legacy-shaped user_food_prefs row (sentiment only) survives with target/reason null", async () => {
    const fresh = createClient({ url: `file:${join(dir, "real.db")}` });
    try {
      await migrate(drizzle(fresh), { migrationsFolder: DRIZZLE_DIR });
      // Seed a pre-feature food-pref row that carries only a sentiment (no target/reason) — the shape
      // every existing prod row has. The relaxed-nullable schema must accept and preserve it. FK
      // enforcement off so we don't need a full users row (the survival property is on user_food_prefs).
      await fresh.execute("PRAGMA foreign_keys=OFF");
      await fresh.execute({
        sql: "INSERT INTO user_food_prefs (user_id, facet, value, sentiment) VALUES (?,?,?,?)",
        args: ["u-legacy", "cuisine", "thai", "like"],
      });
      const [row] = (await fresh.execute("SELECT sentiment, target, reason FROM user_food_prefs")).rows;
      expect(row.sentiment).toBe("like");
      expect(row.target).toBeNull();
      expect(row.reason).toBeNull();
    } finally {
      fresh.close();
    }
  });
});
