import { type Database } from "../../src/db.js";
import { buildApp } from "../../src/index.js";
import { migratedFileDb } from "./migrated-db.js";

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
  const { db, cleanup } = await migratedFileDb();
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
    cleanup,
  };
}
