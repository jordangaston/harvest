import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { makeDb, type Database } from "../../src/db.js";
import { buildApp } from "../../src/index.js";

/**
 * Shared fast-tier harness for the ported Wave-2 suites (grocery, meal-plan,
 * recipes-list, user-delete). Builds a throwaway `file:` libSQL db from the
 * generated DDL and the Hono app over it — offline, no network, mirroring the
 * existing test/*.test.ts pattern.
 */
export interface Harness {
  db: Database;
  app: ReturnType<typeof buildApp>;
  mintBearer: (prefix?: string) => Promise<{ token: string; userId: string }>;
  auth: (token: string) => Record<string, string>;
  cleanup: () => void;
}

/** Creates a fresh migrated db + app. `await` it in `beforeEach`; `cleanup()` in `afterEach`. */
export async function makeHarness(): Promise<Harness> {
  const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");
  const sqlFile = readdirSync(drizzleDir).find((f) => f.endsWith(".sql"));
  if (!sqlFile) throw new Error("run `npm run db:generate` first — no drizzle/*.sql found");
  const dir = mkdtempSync(join(tmpdir(), "harvest-wave2-"));
  const client = createClient({ url: `file:${join(dir, "t.db")}` });
  await client.executeMultiple(readFileSync(join(drizzleDir, sqlFile), "utf8"));
  const db = makeDb(client);
  const app = buildApp(db);
  let phoneSeq = 0;

  async function mintBearer(prefix = "+1555550"): Promise<{ token: string; userId: string }> {
    const phone = `${prefix}${String(1000 + phoneSeq++).slice(-4)}`;
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: { phone_number: phone } }),
    });
    const body = await res.json();
    return { token: body.auth.access_token.jwt, userId: body.user.id };
  }

  return {
    db,
    app,
    mintBearer,
    auth: (token) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
