import { type Database } from "../../src/db.js";
import { buildApp } from "../../src/index.js";
import { HouseholdRepository } from "../../src/repositories/household-repository.js";
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
  /** Creates a household owned by `ownerUserId` and links each member. Returns its id. */
  seedHousehold: (ownerUserId: string, memberUserIds?: string[]) => Promise<string>;
  auth: (token: string) => Record<string, string>;
  cleanup: () => void;
}

/** Creates a fresh migrated db + app. `await` it in `beforeEach`; `cleanup()` in `afterEach`. */
export async function makeHarness(): Promise<Harness> {
  const { db, cleanup } = await migratedFileDb();
  const app = buildApp(db);
  const households = HouseholdRepository.create(db);
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

  async function seedHousehold(ownerUserId: string, memberUserIds: string[] = [ownerUserId]): Promise<string> {
    const household = await households.createHousehold({ ownerUserId });
    await households.addMembers(household.id, memberUserIds);
    return household.id;
  }

  return {
    db,
    app,
    mintBearer,
    seedHousehold,
    auth: (token) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
    cleanup,
  };
}
