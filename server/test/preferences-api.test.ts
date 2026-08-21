import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { tasteIngredients } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

// A base ingredient the picker offers; an `ingredient` pref's value must be its id.
const LIVER_ID = "ti-liver";

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
  await db.insert(tasteIngredients).values({ id: LIVER_ID, label: "Liver", section: "Meat & Seafood", foodGroup: 2 });
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
  likes: [{ facet: "cuisine", value: "italian" }, { facet: "dish_type", value: "bowls" }],
  dislikes: [{ facet: "ingredient", value: LIVER_ID }],
  allergens: [{ allergen: "peanut", severity: "severe" }],
  diets: [{ diet: "pescatarian", strictness: "flexible" }],
  owned_equipment: ["blender", "slow_cooker"],
  grocery_stores: ["walmart", "kroger"],
  household_adults: 2,
  household_kids: 3,
  eats_leftovers: true,
};

describe("preferences API (WI-1)", () => {
  it("GET returns cold-start defaults for a new user (weekly_meals all zero)", async () => {
    const token = await mintToken();
    const { status, body } = await getPrefs(token);
    expect(status).toBe(200);
    expect(body.preferences.weekly_meals).toEqual({ breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 });
    expect(body.preferences.weekly_budget_cents).toBeNull();
    expect(body.preferences.likes).toEqual([]);
    expect(body.preferences.owned_equipment).toEqual([]);
    expect(body.preferences.grocery_stores).toEqual([]);
    expect(body.preferences.household_adults).toBe(2);
    expect(body.preferences.household_kids).toBe(0);
    expect(body.preferences.eats_leftovers).toBe(true);
    // Legacy keys are gone.
    expect(body.preferences.liked_cuisines).toBeUndefined();
    expect(body.preferences.disliked_ingredients).toBeUndefined();
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
    expect(body.preferences.likes).toContainEqual({ facet: "cuisine", value: "italian" });
    expect(body.preferences.likes).toContainEqual({ facet: "dish_type", value: "bowls" });
    expect(body.preferences.dislikes).toEqual([{ facet: "ingredient", value: LIVER_ID }]);
    expect(body.preferences.allergens).toContainEqual({ allergen: "peanut", severity: "severe" });
    expect(body.preferences.diets).toContainEqual({ diet: "pescatarian", strictness: "flexible" });
    expect(body.preferences.owned_equipment.sort()).toEqual(["blender", "slow_cooker"]);
    expect(body.preferences.grocery_stores.sort()).toEqual(["kroger", "walmart"]);
    expect(body.preferences.household_kids).toBe(3);
    expect(body.preferences.eats_leftovers).toBe(true);
  });

  it("rejects an ingredient pref whose value is not a known base_ingredient_id with 422", async () => {
    const token = await mintToken();
    const bad = await putPrefs(token, { ...VALID, dislikes: [{ facet: "ingredient", value: "not-a-real-id" }] });
    expect(bad.status).toBe(422);
    // Cuisine/dish_type values are code-vocab, not DB-checked here — an unknown one is accepted.
    const okCuisine = await putPrefs(token, { ...VALID, likes: [{ facet: "cuisine", value: "anything" }], dislikes: [] });
    expect(okCuisine.status).toBe(200);
  });

  it("rejects an unknown grocery store with 400 (Test Case 4)", async () => {
    const token = await mintToken();
    const bad = await putPrefs(token, { ...VALID, grocery_stores: ["not_a_store"] });
    expect(bad.status).toBe(400);
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
