import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recipes, recipeCategories, userPreferences } from '../src/schema.js';
import { MealPlanRepository } from '../src/repositories/meal-plan-repository.js';
import { makeHarness, type Harness } from './helpers/wave2-harness.js';

/** WI-MP-3 + WI-MP-4 — generate / shuffle / regenerate / slot-options / fill endpoints. */

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

const START = '2026-08-03';
const END = '2026-08-09';

/** A global recipe for `meal`, with a distinct cuisine (so MMR sees them as varied) + cost/time. */
async function seed(i: number, meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' = 'dinner', o: { cost?: number; minutes?: number } = {}): Promise<string> {
  const [row] = await h.db
    .insert(recipes)
    .values({ userId: null, title: `R${meal}${i}`, sourceType: 'website', costPerServingCents: o.cost ?? 500, totalMinutes: o.minutes ?? 30, allergens: { contains: [], mayContain: [] }, allergensComplete: true })
    .returning({ id: recipes.id });
  await h.db.insert(recipeCategories).values([
    { recipeId: row.id, facet: 'meal_type', value: meal },
    { recipeId: row.id, facet: 'cuisine', value: `cuisine-${meal}-${i}` },
  ]);
  return row.id;
}

async function setPlanPrefs(userId: string, weeklyMeals: Record<string, number>, budget = 10_000_000) {
  await h.db.insert(userPreferences).values({ userId, weeklyMeals: { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0, ...weeklyMeals }, weeklyBudgetCents: budget });
}

const gen = (token: string, body: object) =>
  h.app.request('/v1/meal-plan/generate', { method: 'POST', headers: h.auth(token), body: JSON.stringify(body) });

describe('POST /v1/meal-plan/generate', () => {
  it('fills weekly_meals counts, persists as generated, preserves a manual entry (AC1, AC3)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { lunch: 2, dinner: 2 });
    for (let i = 0; i < 4; i++) { await seed(i, 'lunch'); await seed(i, 'dinner'); }
    const manual = await seed(99, 'dinner');
    await MealPlanRepository.create(h.db).replaceSlot(me.userId, START, 'dinner', manual, 'manual');

    const res = await gen(me.token, { start: START, end: END });
    expect(res.status).toBe(200);
    const { plan } = await res.json();
    expect(plan.entries.filter((e: { meal: string }) => e.meal === 'lunch')).toHaveLength(2);
    expect(plan.entries.filter((e: { meal: string }) => e.meal === 'dinner')).toHaveLength(2);
    expect(plan.entries[0].recipe).toMatchObject({ id: expect.any(String), title: expect.any(String) });
    expect(plan.entries[0].tier).toBeDefined();

    const get = await h.app.request(`/v1/meal-plan?start=${START}&end=${END}`, { headers: h.auth(me.token) });
    const entries = (await get.json()).entries;
    // 2 lunch + 2 dinner generated, plus the untouched manual dinner = 5.
    expect(entries).toHaveLength(5);
    expect(entries.some((e: { recipe: { id: string } }) => e.recipe.id === manual)).toBe(true);
  });

  it('preview returns a plan without persisting (AC2)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { dinner: 2 });
    for (let i = 0; i < 4; i++) await seed(i, 'dinner');

    const { plan } = await (await gen(me.token, { start: START, end: END, preview: true })).json();
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0].id).toBeNull();
    const get = await h.app.request(`/v1/meal-plan?start=${START}&end=${END}`, { headers: h.auth(me.token) });
    expect((await get.json()).entries).toHaveLength(0); // nothing written
  });

  it('shuffle re-rolls off the current plan (AC9)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { dinner: 3 });
    for (let i = 0; i < 6; i++) await seed(i, 'dinner'); // 6 candidates, plan uses 3

    const first = new Set((await (await gen(me.token, { start: START, end: END })).json()).plan.entries.map((e: { recipe: { id: string } }) => e.recipe.id));
    const second = new Set((await (await gen(me.token, { start: START, end: END, shuffle: true })).json()).plan.entries.map((e: { recipe: { id: string } }) => e.recipe.id));
    expect(second.size).toBe(3);
    for (const id of second) expect(first.has(id as string)).toBe(false); // disjoint — a real shuffle
  });

  it('422 on an empty plan, 400 on too-wide a range (AC4)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, {}); // all zero
    expect((await gen(me.token, { start: START, end: END })).status).toBe(422);

    await h.db.update(userPreferences).set({ weeklyMeals: { breakfast: 0, lunch: 0, dinner: 1, snack: 0, kids: 0 } });
    expect((await gen(me.token, { start: START, end: '2026-09-30' })).status).toBe(400);
  });

  it('401 without a bearer (AC7)', async () => {
    expect((await h.app.request('/v1/meal-plan/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: START, end: END }) })).status).toBe(401);
  });
});

describe('POST /v1/meal-plan/regenerate', () => {
  const roll = (token: string, body: object) =>
    h.app.request('/v1/meal-plan/regenerate', { method: 'POST', headers: h.auth(token), body: JSON.stringify(body) });

  it('re-rolls one slot to a fresh recipe (AC5)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { dinner: 1 });
    const a = await seed(0, 'dinner');
    const b = await seed(1, 'dinner');
    await MealPlanRepository.create(h.db).replaceSlot(me.userId, START, 'dinner', a, 'generated');

    const res = await roll(me.token, { date: START, meal: 'dinner', exclude_recipe_id: a });
    expect(res.status).toBe(200);
    expect((await res.json()).entry.recipe.id).toBe(b); // the only other candidate
  });

  it('409s when the pool is exhausted (AC5)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { dinner: 1 });
    const only = await seed(0, 'dinner');
    await MealPlanRepository.create(h.db).replaceSlot(me.userId, START, 'dinner', only, 'generated');
    // Excluding the sole candidate leaves nothing eligible.
    expect((await roll(me.token, { date: START, meal: 'dinner', exclude_recipe_id: only })).status).toBe(409);
  });
});

describe('GET /v1/meal-plan/slot-options + POST /v1/meal-plan/slot', () => {
  it('returns ranked options excluding the current pick, then fills the slot as a protected pick (WI-MP-4)', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { dinner: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await seed(i, 'dinner'));
    await MealPlanRepository.create(h.db).replaceSlot(me.userId, START, 'dinner', ids[0], 'generated');

    const opts = await h.app.request(`/v1/meal-plan/slot-options?date=${START}&meal=dinner&limit=4&exclude=${ids[0]}`, { headers: h.auth(me.token) });
    expect(opts.status).toBe(200);
    const { options } = await opts.json();
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(4);
    expect(options.every((o: { recipe: { id: string } }) => o.recipe.id !== ids[0])).toBe(true); // current pick excluded

    const chosen = options[0].recipe.id;
    const fill = await h.app.request('/v1/meal-plan/slot', { method: 'POST', headers: h.auth(me.token), body: JSON.stringify({ date: START, meal: 'dinner', recipe_id: chosen }) });
    expect(fill.status).toBe(200);
    expect((await fill.json()).entry.recipe.id).toBe(chosen);

    // A subsequent week-generate must not overwrite the deliberate (manual) pick.
    await gen(me.token, { start: START, end: END, shuffle: true });
    const get = await h.app.request(`/v1/meal-plan?start=${START}&end=${END}`, { headers: h.auth(me.token) });
    expect((await get.json()).entries.some((e: { recipe: { id: string } }) => e.recipe.id === chosen)).toBe(true);
  });

  it('404s a fill with a recipe the caller cannot see', async () => {
    const me = await h.mintBearer();
    await setPlanPrefs(me.userId, { dinner: 1 });
    const other = await h.mintBearer();
    const [priv] = await h.db.insert(recipes).values({ userId: other.userId, title: 'private', sourceType: 'website' }).returning({ id: recipes.id });
    const res = await h.app.request('/v1/meal-plan/slot', { method: 'POST', headers: h.auth(me.token), body: JSON.stringify({ date: START, meal: 'dinner', recipe_id: priv.id }) });
    expect(res.status).toBe(404);
  });
});
