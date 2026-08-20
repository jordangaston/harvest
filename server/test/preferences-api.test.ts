import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * WI-1: GET/PUT /v1/preferences. Offline against a migrated `file:` libSQL db. Mint a bearer
 * via POST /v1/users, drive the endpoints through app.request (mirrors swipe-deck.test.ts).
 */
let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
});
afterEach(() => cleanup());

async function mintToken(): Promise<string> {
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  return (await res.json()).auth.access_token.jwt;
}

async function getPrefs(token: string) {
  const res = await app.request("/v1/preferences", { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function putPrefs(token: string, body: unknown) {
  const res = await app.request("/v1/preferences", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

const VALID = {
  skill_level: "advanced",
  weekly_budget_cents: 12000,
  time_budget_minutes: 45,
  weekly_meals: { breakfast: 3, lunch: 0, dinner: 5, snack: 2, kids: 0 },
  liked_cuisines: ["italian", "mexican"],
  disliked_ingredients: ["liver"],
  allergens: [{ allergen: "peanut", severity: "severe" }],
  diets: [{ diet: "pescatarian", strictness: "flexible" }],
  owned_equipment: ["blender", "slow_cooker"],
};

describe("preferences API (WI-1)", () => {
  it("GET returns cold-start defaults for a new user (weekly_meals all zero)", async () => {
    const token = await mintToken();
    const { status, body } = await getPrefs(token);
    expect(status).toBe(200);
    expect(body.preferences.weekly_meals).toEqual({ breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 });
    expect(body.preferences.weekly_budget_cents).toBeNull();
    expect(body.preferences.liked_cuisines).toEqual([]);
    expect(body.preferences.owned_equipment).toEqual([]);
  });

  it("PUT then GET round-trips the editable subset", async () => {
    const token = await mintToken();
    const put = await putPrefs(token, VALID);
    expect(put.status).toBe(200);
    expect(put.body.preferences.weekly_meals).toEqual(VALID.weekly_meals);

    const { body } = await getPrefs(token);
    expect(body.preferences.skill_level).toBe("advanced");
    expect(body.preferences.weekly_budget_cents).toBe(12000);
    expect(body.preferences.weekly_meals).toEqual(VALID.weekly_meals);
    expect(body.preferences.liked_cuisines.sort()).toEqual(["italian", "mexican"]);
    expect(body.preferences.disliked_ingredients).toEqual(["liver"]);
    expect(body.preferences.allergens).toContainEqual({ allergen: "peanut", severity: "severe" });
    expect(body.preferences.diets).toContainEqual({ diet: "pescatarian", strictness: "flexible" });
    expect(body.preferences.owned_equipment.sort()).toEqual(["blender", "slow_cooker"]);
  });

  it("PUT rejects out-of-range / unknown values with 400 (no partial write)", async () => {
    const token = await mintToken();
    await putPrefs(token, VALID); // establish a known-good baseline
    const bad = await putPrefs(token, { ...VALID, weekly_meals: { ...VALID.weekly_meals, dinner: -1 } });
    expect(bad.status).toBe(400);
    const badEquip = await putPrefs(token, { ...VALID, owned_equipment: ["teleporter"] });
    expect(badEquip.status).toBe(400);
    // Baseline survived the rejected writes.
    expect((await getPrefs(token)).body.preferences.weekly_meals.dinner).toBe(5);
  });

  it("401 without a bearer", async () => {
    expect((await app.request("/v1/preferences")).status).toBe(401);
    expect((await app.request("/v1/preferences", { method: "PUT", body: "{}" })).status).toBe(401);
  });
});
