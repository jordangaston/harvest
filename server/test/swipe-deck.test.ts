import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import {
  recipes,
  recipeCategories,
  recipeSwipes,
  recipeEquipment,
  recipeDiets,
  cookbooks,
  cookbookRecipes,
  userPreferences,
  userFoodPrefs,
} from "../src/schema.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * WI-RANK-4: GET /v1/recipes/deck + POST /v1/recipes/:id/swipe, offline against a
 * migrated `file:` libSQL db. Mirrors ranked-recipes.test.ts: seed via db.insert, mint
 * a bearer via POST /v1/users, drive the endpoints through app.request.
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

async function mintUser(goals?: string[]): Promise<{ token: string; userId: string }> {
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone, onboarding: goals ? { goals } : undefined } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

/** Inserts a recipe owned by `userId` (null = global) and returns its id. */
async function seedRecipe(
  userId: string | null,
  r: { title: string; nrfScore?: number | null; createdAt?: Date },
): Promise<string> {
  const [row] = await db
    .insert(recipes)
    .values({
      userId,
      title: r.title,
      sourceType: "website",
      nrfScore: r.nrfScore == null ? null : String(r.nrfScore),
      allergensComplete: true,
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    })
    .returning({ id: recipes.id });
  return row!.id;
}

async function getDeck(token: string, query = ""): Promise<{ status: number; body: any }> {
  const res = await app.request(`/v1/recipes/deck${query}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function swipe(
  token: string,
  recipeId: string,
  swipeBody: { direction: string; reason?: string; reason_detail?: string },
): Promise<{ status: number; body: any }> {
  const res = await app.request(`/v1/recipes/${recipeId}/swipe`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(swipeBody),
  });
  return { status: res.status, body: await res.json() };
}

async function unswipe(token: string, recipeId: string): Promise<number> {
  const res = await app.request(`/v1/recipes/${recipeId}/swipe`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  return res.status;
}

describe("swipe deck & feedback (WI-RANK-4)", () => {
  it("TC1: deck returns ranked unswiped cards", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    await seedRecipe(userId, { title: "High", nrfScore: 90 });
    await seedRecipe(userId, { title: "Mid", nrfScore: 60 });
    await seedRecipe(userId, { title: "Low", nrfScore: 30 });

    const { status, body } = await getDeck(token, "?limit=5");
    expect(status).toBe(200);
    expect(body.recipes.map((x: any) => x.recipe.title)).toEqual(["High", "Mid", "Low"]);
    for (const card of body.recipes) {
      expect(typeof card.score).toBe("number");
      expect(Object.keys(card.breakdown).length).toBeGreaterThan(0);
    }
    expect(body.page_token).toBeUndefined();
  });

  it("TC2: swiped cards leave the deck", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const top = await seedRecipe(userId, { title: "High", nrfScore: 90 });
    await seedRecipe(userId, { title: "Mid", nrfScore: 60 });

    await swipe(token, top, { direction: "dislike" });
    const { body } = await getDeck(token);
    expect(body.recipes.map((x: any) => x.recipe.title)).toEqual(["Mid"]);
  });

  it("TC3: like adds to the Liked cookbook (created once, reused, permanent exclusion)", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const r1 = await seedRecipe(userId, { title: "High", nrfScore: 90 });
    const r2 = await seedRecipe(userId, { title: "Mid", nrfScore: 60 });

    expect((await swipe(token, r1, { direction: "like" })).status).toBe(200);
    expect((await swipe(token, r2, { direction: "like" })).status).toBe(200);

    const liked = await db
      .select()
      .from(cookbooks)
      .where(and(eq(cookbooks.userId, userId), eq(cookbooks.systemSlug, "liked")));
    expect(liked.length).toBe(1);
    expect(liked[0]!.name).toBe("Liked");
    const members = await db.select().from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, liked[0]!.id));
    expect(new Set(members.map((m) => m.recipeId))).toEqual(new Set([r1, r2]));

    // Permanent exclusion: even past the cooldown, a liked recipe never resurfaces.
    await db
      .update(recipeSwipes)
      .set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(and(eq(recipeSwipes.userId, userId), eq(recipeSwipes.recipeId, r1)));
    const { body } = await getDeck(token);
    expect(body.recipes.map((x: any) => x.recipe.id)).not.toContain(r1);
  });

  it("TC3b: save adds to the Saved cookbook (permanent exclusion, distinct from Liked)", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const r1 = await seedRecipe(userId, { title: "High", nrfScore: 90 });
    await seedRecipe(userId, { title: "Mid", nrfScore: 60 });

    const { status, body } = await swipe(token, r1, { direction: "save" });
    expect(status).toBe(200);
    expect(body.swipe.direction).toBe("save");

    const saved = await db
      .select()
      .from(cookbooks)
      .where(and(eq(cookbooks.userId, userId), eq(cookbooks.systemSlug, "saved")));
    expect(saved.length).toBe(1);
    expect(saved[0]!.name).toBe("Saved");
    const members = await db.select().from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, saved[0]!.id));
    expect(members.map((m) => m.recipeId)).toEqual([r1]);

    // Permanent exclusion: even past the cooldown, a saved recipe never resurfaces.
    await db
      .update(recipeSwipes)
      .set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(and(eq(recipeSwipes.userId, userId), eq(recipeSwipes.recipeId, r1)));
    const { body: deck } = await getDeck(token);
    expect(deck.recipes.map((x: any) => x.recipe.id)).not.toContain(r1);
  });

  it("TC4: snapshot captures score + current weights", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const r = await seedRecipe(userId, { title: "High", nrfScore: 90 });

    const { body } = await swipe(token, r, { direction: "dislike" });
    const [row] = await db.select().from(recipeSwipes).where(eq(recipeSwipes.recipeId, r));
    expect(row!.score).toBeCloseTo(body.swipe.score, 5);
    // eat_healthier cold-start: nutrition bumped to 3, others 1, popularity 0, meal-prep 1.
    expect(row!.weights).toEqual({ cost: 1, difficulty: 1, nutrition: 3, affinity: 1, time: 1, popularity: 0, mealPrep: 1 });
  });

  it("TC5: reasoned dislike tunes the mapped weight (cold-start → row created, capped at 3)", async () => {
    const { token, userId } = await mintUser(); // no goals: all weights 1
    const r1 = await seedRecipe(userId, { title: "A" });
    const r2 = await seedRecipe(userId, { title: "B" });
    const r3 = await seedRecipe(userId, { title: "C" });

    expect(await hasPrefsRow(userId)).toBe(false);
    await swipe(token, r1, { direction: "dislike", reason: "too_expensive" });
    const first = await prefsRow(userId);
    expect(first).not.toBeNull();
    expect(first!.weightCost).toBe(2); // coldstart 1 + 1
    expect(first!.weightDifficulty).toBe(1); // untouched

    await swipe(token, r2, { direction: "dislike", reason: "too_expensive" });
    expect((await prefsRow(userId))!.weightCost).toBe(3);
    await swipe(token, r3, { direction: "dislike", reason: "too_expensive" });
    expect((await prefsRow(userId))!.weightCost).toBe(3); // capped
  });

  it("TC6: disliked_ingredient adds a food-pref (record-only without detail)", async () => {
    const { token, userId } = await mintUser();
    const r1 = await seedRecipe(userId, { title: "A" });
    const r2 = await seedRecipe(userId, { title: "B" });

    await swipe(token, r1, { direction: "dislike", reason: "disliked_ingredient", reason_detail: "liver" });
    const prefs = await db
      .select()
      .from(userFoodPrefs)
      .where(and(eq(userFoodPrefs.userId, userId), eq(userFoodPrefs.value, "liver")));
    expect(prefs.length).toBe(1);
    expect(prefs[0]!.facet).toBe("primary_ingredient");
    expect(prefs[0]!.sentiment).toBe("dislike");

    await swipe(token, r2, { direction: "dislike", reason: "disliked_ingredient" }); // no detail
    const all = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId));
    expect(all.length).toBe(1); // no new row
  });

  it("TC7: cooldown resurfacing — old swipe reappears, recent stays hidden", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const old = await seedRecipe(userId, { title: "Old", nrfScore: 90 });
    const recent = await seedRecipe(userId, { title: "Recent", nrfScore: 60 });

    await swipe(token, old, { direction: "dislike" });
    await swipe(token, recent, { direction: "dislike" });
    // Age the "old" dislike past the cooldown window.
    await db
      .update(recipeSwipes)
      .set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(and(eq(recipeSwipes.userId, userId), eq(recipeSwipes.recipeId, old)));

    const { body } = await getDeck(token);
    const ids = body.recipes.map((x: any) => x.recipe.id);
    expect(ids).toContain(old);
    expect(ids).not.toContain(recent);
  });

  it("TC8: auth 401 + cross-user 404", async () => {
    const { userId: owner } = await mintUser();
    const owned = await seedRecipe(owner, { title: "Owned" });
    const { token: other } = await mintUser();

    expect((await app.request("/v1/recipes/deck")).status).toBe(401);
    expect((await app.request(`/v1/recipes/${owned}/swipe`, { method: "POST", body: "{}" })).status).toBe(401);

    const { status, body } = await swipe(other, owned, { direction: "like" });
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("TC9: empty deck", async () => {
    const { token } = await mintUser();
    const { status, body } = await getDeck(token);
    expect(status).toBe(200);
    expect(body).toEqual({ recipes: [] });
  });

  it("TC10: un-swipe deletes the swipe, un-files it, and the recipe returns to the deck", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const r1 = await seedRecipe(userId, { title: "High", nrfScore: 90 });

    await swipe(token, r1, { direction: "like" });
    expect((await getDeck(token)).body.recipes.map((x: any) => x.recipe.id)).not.toContain(r1);

    expect(await unswipe(token, r1)).toBe(204);
    expect(await db.select().from(recipeSwipes).where(eq(recipeSwipes.recipeId, r1))).toHaveLength(0);
    // Un-filed from Liked.
    const liked = await db.select().from(cookbooks).where(and(eq(cookbooks.userId, userId), eq(cookbooks.systemSlug, "liked")));
    const members = await db.select().from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, liked[0]!.id));
    expect(members.map((m) => m.recipeId)).not.toContain(r1);
    // Deck-eligible again.
    expect((await getDeck(token)).body.recipes.map((x: any) => x.recipe.id)).toContain(r1);

    // Idempotent (204 with no prior swipe) + 401 without a bearer.
    expect(await unswipe(token, r1)).toBe(204);
    expect((await app.request(`/v1/recipes/${r1}/swipe`, { method: "DELETE" })).status).toBe(401);
  });

  it("TC11: deck card carries the accent signals + compat data (nutrition, meal-prep, equipment, allergens, diets)", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const [row] = await db
      .insert(recipes)
      .values({
        userId, title: "Prep Star", sourceType: "website", nrfScore: "88", mealPrepFit: "designed",
        allergens: { contains: ["peanut"], mayContain: [] }, allergensComplete: true,
      })
      .returning({ id: recipes.id });
    await db.insert(recipeEquipment).values({ recipeId: row!.id, equipment: "air_fryer", essentiality: "required" });
    await db.insert(recipeDiets).values([
      { recipeId: row!.id, dietId: "vegetarian", verdict: "compatible" },
      { recipeId: row!.id, dietId: "vegan", verdict: "incompatible" }, // only compatible diets surface
    ]);

    const { body } = await getDeck(token);
    const card = body.recipes.find((x: any) => x.recipe.id === row!.id).recipe;
    expect(card.nrf_score).toBe(88);
    expect(card.meal_prep_fit).toBe("designed");
    expect(card.equipment).toEqual([{ equipment: "air_fryer", essentiality: "required" }]);
    expect(card.allergens).toEqual(["peanut"]);
    expect(card.diets).toEqual(["vegetarian"]);
  });

  it("TC12: no ?categories → deck filters to the user's planned meal types (server-side default)", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const dinner = await seedRecipe(userId, { title: "Dinner", nrfScore: 90 });
    const dessert = await seedRecipe(userId, { title: "Dessert", nrfScore: 60 });
    await db.insert(recipeCategories).values([
      { recipeId: dinner, facet: "meal_type", value: "dinner" },
      { recipeId: dessert, facet: "dish_type", value: "dessert" },
    ]);
    await planMeals(userId, { dinner: 5 }); // plans dinner only

    const { body } = await getDeck(token); // no explicit categories
    expect(body.recipes.map((x: any) => x.recipe.id)).toEqual([dinner]);
  });

  it("TC13: the meal-type filter never returns an empty deck — it relaxes to the catalog", async () => {
    const { token, userId } = await mintUser(["eat_healthier"]);
    const dessert = await seedRecipe(userId, { title: "Dessert", nrfScore: 60 });
    await db.insert(recipeCategories).values({ recipeId: dessert, facet: "dish_type", value: "dessert" });
    await planMeals(userId, { dinner: 5 }); // plans dinner, but no dinner recipes exist

    const { body } = await getDeck(token);
    expect(body.recipes.map((x: any) => x.recipe.id)).toEqual([dessert]);
  });
});

/** Sets the user's planned weekly meal counts (drives the default deck meal-type filter). */
async function planMeals(userId: string, meals: Partial<{ breakfast: number; lunch: number; dinner: number; snack: number }>) {
  await db
    .insert(userPreferences)
    .values({ userId, weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0, ...meals } })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0, ...meals } },
    });
}

async function prefsRow(userId: string) {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return row ?? null;
}

async function hasPrefsRow(userId: string): Promise<boolean> {
  return (await prefsRow(userId)) !== null;
}
