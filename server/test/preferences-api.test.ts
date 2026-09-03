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
  // Directive array: taste likes, a taste dislike, a positive-target intent, and a moderation with reason.
  food_prefs: [
    { dimension: "cuisine", value: "italian", direction: "more" },
    { dimension: "dish_type", value: "bowls", direction: "more" },
    { dimension: "ingredient", value: LIVER_ID, direction: "less" },
    { dimension: "food_category", value: "seafood", direction: "more", target: 0.8 },
    { dimension: "food_category", value: "red_meat", direction: "less", strength: "firm", target: -0.6, reason: "heart health" },
  ],
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
    expect(body.preferences.food_prefs).toEqual([]);
    expect(body.preferences.owned_equipment).toEqual([]);
    expect(body.preferences.grocery_stores).toEqual([]);
    expect(body.preferences.household_adults).toBe(2);
    expect(body.preferences.household_kids).toBe(0);
    expect(body.preferences.eats_leftovers).toBe(true);
    // The unified DTO replaced likes/dislikes — those keys are gone.
    expect(body.preferences.likes).toBeUndefined();
    expect(body.preferences.dislikes).toBeUndefined();
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
    // Every axis of every food-pref round-trips (AC 11): taste like, taste dislike, pure
    // moderation (target only), and the combined taste+intent element.
    const fp = body.preferences.food_prefs;
    expect(fp).toContainEqual({ dimension: "cuisine", value: "italian", scope: "recipe", direction: "more", strength: "soft", target: null, unit: null, reason: null });
    expect(fp).toContainEqual({ dimension: "ingredient", value: LIVER_ID, scope: "recipe", direction: "less", strength: "soft", target: null, unit: null, reason: null });
    expect(fp).toContainEqual({ dimension: "food_category", value: "seafood", scope: "recipe", direction: "more", strength: "soft", target: 0.8, unit: null, reason: null });
    expect(fp).toContainEqual({ dimension: "food_category", value: "red_meat", scope: "recipe", direction: "less", strength: "firm", target: -0.6, unit: null, reason: "heart health" });
    // Response carries no legacy likes/dislikes keys.
    expect(body.preferences.likes).toBeUndefined();
    expect(body.preferences.dislikes).toBeUndefined();
    expect(body.preferences.allergens).toContainEqual({ allergen: "peanut", severity: "severe" });
    expect(body.preferences.diets).toContainEqual({ diet: "pescatarian", strictness: "flexible" });
    expect(body.preferences.owned_equipment.sort()).toEqual(["blender", "slow_cooker"]);
    expect(body.preferences.grocery_stores.sort()).toEqual(["kroger", "walmart"]);
    expect(body.preferences.household_kids).toBe(3);
    expect(body.preferences.eats_leftovers).toBe(true);
  });

  it("rejects an ingredient pref whose value is not a known base_ingredient_id with 422", async () => {
    const token = await mintToken();
    const bad = await putPrefs(token, { ...VALID, food_prefs: [{ dimension: "ingredient", value: "not-a-real-id", direction: "less" }] });
    expect(bad.status).toBe(422);
    // Cuisine/dish_type values are code-vocab, not DB-checked here — an unknown one is accepted.
    const okCuisine = await putPrefs(token, { ...VALID, food_prefs: [{ dimension: "cuisine", value: "anything", direction: "more" }] });
    expect(okCuisine.status).toBe(200);
  });

  it("PUT then GET round-trips time_by_meal and returns the derived time_budget_minutes", async () => {
    const token = await mintToken();
    const put = await putPrefs(token, { ...VALID, time_by_meal: { breakfast: 15, lunch: 30, dinner: 60 } });
    expect(put.status).toBe(200);
    expect(put.body.preferences.time_by_meal).toEqual({ breakfast: 15, lunch: 30, dinner: 60 });
    expect(put.body.preferences.time_budget_minutes).toBe(60); // max(15,30,60)

    const { body } = await getPrefs(token);
    expect(body.preferences.time_by_meal).toEqual({ breakfast: 15, lunch: 30, dinner: 60 });
    expect(body.preferences.time_budget_minutes).toBe(60);
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
