import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from "node:fs";
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

describe("food-directive migration backfills every legacy row (WI-1 Test Case 1)", () => {
  const DRIZZLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const DIRECTIVE_TAG = "0036_food_directive";

  /** Copy the real drizzle dir into a temp folder, keeping only journal entries before the WI-1
   *  directive migration — so the migrator can stop at the pre-WI-1 (facet/sentiment) schema. */
  function drizzleDirBeforeDirective(into: string): void {
    const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"));
    const before = journal.entries.filter((e: { tag: string }) => e.tag !== DIRECTIVE_TAG);
    mkdirSync(join(into, "meta"), { recursive: true });
    cpSync(join(DRIZZLE_DIR, "meta"), join(into, "meta"), { recursive: true });
    for (const e of journal.entries) cpSync(join(DRIZZLE_DIR, `${e.tag}.sql`), join(into, `${e.tag}.sql`));
    writeFileSync(join(into, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: before }));
  }

  it("maps facet/sentiment/target legacy rows to dimension/direction, scope=recipe, strength=soft", async () => {
    const beforeDir = join(dir, "before");
    drizzleDirBeforeDirective(beforeDir);
    const client2 = createClient({ url: `file:${join(dir, "real.db")}` });
    try {
      // Migrate to the pre-WI-1 schema (facet/sentiment columns), then seed the three legacy shapes.
      await migrate(drizzle(client2), { migrationsFolder: beforeDir });
      await client2.execute("PRAGMA foreign_keys=OFF");
      await client2.execute({ sql: "INSERT INTO user_food_prefs (user_id, facet, value, sentiment) VALUES (?,?,?,?)", args: ["u", "cuisine", "thai", "like"] });
      await client2.execute({ sql: "INSERT INTO user_food_prefs (user_id, facet, value, sentiment) VALUES (?,?,?,?)", args: ["u", "primary_ingredient", "liver", "dislike"] });
      await client2.execute({ sql: "INSERT INTO user_food_prefs (user_id, facet, value, target) VALUES (?,?,?,?)", args: ["u", "food_category", "red_meat", -0.9] });

      // Apply the WI-1 directive migration (the only pending one against the full drizzle dir).
      await migrate(drizzle(client2), { migrationsFolder: DRIZZLE_DIR });

      const rows = (await client2.execute("SELECT dimension, value, scope, direction, strength, target FROM user_food_prefs ORDER BY value")).rows;
      expect(rows).toContainEqual(expect.objectContaining({ dimension: "cuisine", value: "thai", scope: "recipe", direction: "more", strength: "soft" }));
      expect(rows).toContainEqual(expect.objectContaining({ dimension: "primary_ingredient", value: "liver", direction: "less" }));
      expect(rows).toContainEqual(expect.objectContaining({ dimension: "food_category", value: "red_meat", direction: "less", target: -0.9 }));
    } finally {
      client2.close();
    }
  });
});
