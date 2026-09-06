import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";

/**
 * AC-1: the 0043 migration moves grocery_items to household scope on a DB with existing rows.
 * Rather than run the whole journal (which lands on the already-migrated shape), this
 * reconstructs the PRE-0043 state — the old user-scoped grocery_items plus the referenced
 * tables — seeds rows, runs the real 0043 SQL, and asserts the deterministic backfill +
 * orphan delete + final shape. Proves the migration is runnable against real rows.
 */
const MIGRATION = resolve(dirname(fileURLToPath(import.meta.url)), "..", "drizzle", "0043_household_grocery_items.sql");

let client: Client;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grocery-mig-"));
  client = createClient({ url: `file:${join(dir, "t.db")}` });
});
afterEach(() => {
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function exec(sql: string) {
  for (const stmt of sql.split("--> statement-breakpoint")) {
    // Drop comment-only / blank chunks — libsql errors on a statement with no SQL.
    const trimmed = stmt
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (trimmed) await client.execute(trimmed);
  }
}

describe("0043 household grocery migration", () => {
  beforeEach(async () => {
    // Minimal pre-0043 shape: the referenced tables + the OLD user-scoped grocery_items (0000_init).
    await exec(`
      CREATE TABLE users (id text PRIMARY KEY NOT NULL);--> statement-breakpoint
      CREATE TABLE recipes (id text PRIMARY KEY NOT NULL);--> statement-breakpoint
      CREATE TABLE households (id text PRIMARY KEY NOT NULL);--> statement-breakpoint
      CREATE TABLE household_members (
        id text PRIMARY KEY NOT NULL,
        household_id text NOT NULL,
        user_id text NOT NULL
      );--> statement-breakpoint
      CREATE UNIQUE INDEX household_members_user_id_unique ON household_members (user_id);--> statement-breakpoint
      CREATE TABLE grocery_items (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        name text NOT NULL,
        amount text,
        unit text,
        quantity_text text,
        aisle text NOT NULL,
        icon text DEFAULT 'default' NOT NULL,
        checked integer DEFAULT false NOT NULL,
        source_recipe_id text,
        position integer DEFAULT 0 NOT NULL,
        created_at integer NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
        FOREIGN KEY (source_recipe_id) REFERENCES recipes(id) ON DELETE set null
      );--> statement-breakpoint
      CREATE INDEX grocery_items_user_idx ON grocery_items (user_id);
    `);
    // Users A, B (both in household H1) and C (no membership).
    await client.execute("INSERT INTO users (id) VALUES ('uA'), ('uB'), ('uC')");
    await client.execute("INSERT INTO households (id) VALUES ('H1')");
    await client.execute("INSERT INTO household_members (id, household_id, user_id) VALUES ('m1','H1','uA'), ('m2','H1','uB')");
    // A row each for A, B, C.
    const row = (id: string, userId: string, name: string) =>
      `INSERT INTO grocery_items (id, user_id, name, aisle, created_at) VALUES ('${id}','${userId}','${name}','other',0)`;
    await client.execute(row("gA", "uA", "eggs"));
    await client.execute(row("gB", "uB", "milk"));
    await client.execute(row("gC", "uC", "orphan"));
  });

  it("backfills household_id + added_by_user_id, deletes orphans, and drops user_id", async () => {
    await exec(readFileSync(MIGRATION, "utf8"));

    const rows = await client.execute("SELECT id, household_id, added_by_user_id FROM grocery_items ORDER BY id");
    // C's orphan row (owner has no household) is gone; A + B survive under H1.
    expect(rows.rows.map((r) => r.id)).toEqual(["gA", "gB"]);
    expect(rows.rows.every((r) => r.household_id === "H1")).toBe(true);
    expect(rows.rows.find((r) => r.id === "gA")!.added_by_user_id).toBe("uA");
    expect(rows.rows.find((r) => r.id === "gB")!.added_by_user_id).toBe("uB");

    // user_id column dropped; household index re-keyed.
    const cols = (await client.execute("PRAGMA table_info(grocery_items)")).rows.map((r) => r.name);
    expect(cols).not.toContain("user_id");
    expect(cols).toContain("household_id");
    expect(cols).toContain("added_by_user_id");
    const indexes = (await client.execute("PRAGMA index_list(grocery_items)")).rows.map((r) => r.name);
    expect(indexes).toContain("grocery_items_household_idx");
    expect(indexes).not.toContain("grocery_items_user_idx");
  });

  it("is safe to re-run the backfill before the drop (idempotent, deterministic)", async () => {
    const full = readFileSync(MIGRATION, "utf8");
    // Steps 1-2 are everything up to the first DROP INDEX (step 3, the point of no return).
    const additive = full.slice(0, full.indexOf("DROP INDEX"));
    await exec(additive);
    // Re-running only the backfill UPDATE + orphan DELETE must not change the result.
    const backfillAndDelete = additive
      .split("--> statement-breakpoint")
      .filter((s) => /^\s*(UPDATE|DELETE)/.test(s))
      .join("--> statement-breakpoint");
    await exec(backfillAndDelete);
    const survivors = await client.execute("SELECT id, household_id, added_by_user_id FROM grocery_items ORDER BY id");
    expect(survivors.rows.map((r) => r.id)).toEqual(["gA", "gB"]);
    expect(survivors.rows.every((r) => r.household_id === "H1")).toBe(true);
    expect(survivors.rows.find((r) => r.id === "gA")!.added_by_user_id).toBe("uA");
  });
});
