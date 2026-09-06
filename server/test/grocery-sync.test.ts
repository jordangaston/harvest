import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { migratedFileDb } from './helpers/migrated-db.js';
import { type Database } from '../src/db.js';
import { users, groceryItems } from '../src/schema.js';
import { RecipeRepository, type RecipeInput } from '../src/repositories/recipe-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { GroceryService } from '../src/services/grocery-service.js';
import { GrocerySync } from '../src/services/grocery-sync.js';
import { MealPlanService } from '../src/services/meal-plan-service.js';

/**
 * WI-02 — the list follows the plan (F-05). The reconcile hook at the meal-plan chokepoints keeps
 * the household's recipe-sourced grocery rows equal to what the plan owner's plan implies: adds and
 * removes by diff, never touches manual or checked rows, and writes nothing on replay. Offline: a
 * migrated `file:` db, no network.
 */

let db: Database;
let cleanup: () => void;
let seq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** The reconcile window is [today, today+7]; plan into it. */
const planDate = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10); // tomorrow

/** A recipe carrying the given uniquely-named ingredients. */
function recipeWith(title: string, ings: { name: string; amount?: string; unit?: string }[]): RecipeInput {
  return {
    title,
    sourceType: 'website',
    servings: 4,
    servingsEstimated: false,
    ingredients: ings.map((i) => ({ name: i.name, amount: i.amount ?? '1', unit: i.unit ?? 'cup', quantityText: `${i.amount ?? '1'} ${i.unit ?? 'cup'} ${i.name}` })),
    steps: ['cook'],
    nutrition: null,
    allergens: null,
  };
}

async function seedUserHousehold(): Promise<{ userId: string; householdId: string }> {
  const [u] = await db.insert(users).values({ imessageHandle: `+1555${String(1000000 + seq++)}`, jwtPrivateKey: '', jwtPublicKey: '' }).returning({ id: users.id });
  const household = await HouseholdRepository.create(db).createHousehold({ ownerUserId: u!.id });
  await HouseholdRepository.create(db).addMember({ householdId: household.id, userId: u!.id });
  return { userId: u!.id, householdId: household.id };
}

/** The household's grocery rows, name-sorted, for stable snapshots. */
const rows = (householdId: string) =>
  GroceryService.create(db).list(householdId).then((r) => [...r].sort((a, b) => a.name.localeCompare(b.name)));

describe('WI-02 TC-1 — a mutation stocks the list; manual rows survive', () => {
  it('adds recipe-sourced rows per ingredient (with source ids) and leaves a manual row alone', async () => {
    const { userId, householdId } = await seedUserHousehold();
    const recipes = RecipeRepository.create(db);
    const recipeId = await recipes.persist(recipeWith('Tacos', [{ name: 'tortillas' }, { name: 'ground beef' }, { name: 'cheddar' }]), userId);

    // A manual row seeded before the sync fires.
    await GroceryService.create(db).add(householdId, [{ name: 'paper towels', amount: 1 }], userId);

    await MealPlanService.create(db).add(userId, planDate(), 'dinner', recipeId, 'manual');

    const list = await rows(householdId);
    const sourced = list.filter((r) => r.sourceRecipeId);
    expect(sourced.map((r) => r.name).sort()).toEqual(['cheddar', 'ground beef', 'tortillas']);
    expect(sourced.every((r) => r.sourceRecipeId === recipeId)).toBe(true);
    // Manual row untouched (source null, still present).
    const manual = list.filter((r) => !r.sourceRecipeId);
    expect(manual.map((r) => r.name)).toEqual(['paper towels']);
  });
});

describe('WI-02 TC-2 — reconcile is idempotent', () => {
  it('a second reconcile with no plan change writes zero rows (row identity preserved)', async () => {
    const { userId, householdId } = await seedUserHousehold();
    const recipes = RecipeRepository.create(db);
    const recipeId = await recipes.persist(recipeWith('Soup', [{ name: 'carrots' }, { name: 'broth' }]), userId);
    await MealPlanService.create(db).add(userId, planDate(), 'dinner', recipeId, 'manual');

    const before = await rows(householdId);
    await GrocerySync.create(db).reconcile(userId); // replay
    const after = await rows(householdId);

    // Same rows, same ids — nothing rewritten.
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
  });
});

describe('WI-02 TC-3 — swap semantics', () => {
  it('R unchecked items leave, R checked item survives, S items arrive, manual untouched', async () => {
    const { userId, householdId } = await seedUserHousehold();
    const recipes = RecipeRepository.create(db);
    const groceries = GroceryService.create(db);
    const mealPlan = MealPlanService.create(db);
    const date = planDate();

    const rId = await recipes.persist(recipeWith('R', [{ name: 'r-onion' }, { name: 'r-garlic' }]), userId);
    const sId = await recipes.persist(recipeWith('S', [{ name: 's-basil' }]), userId);

    await groceries.add(householdId, [{ name: 'napkins', amount: 1 }], userId); // manual
    await mealPlan.add(userId, date, 'dinner', rId, 'manual');

    // Check off one of R's items — it was bought, so it must survive R leaving the plan.
    const rGarlic = (await rows(householdId)).find((r) => r.name === 'r-garlic')!;
    await groceries.patch(householdId, rGarlic.id, { checked: true });

    // Swap: remove R from the slot, add S.
    await mealPlan.removeFromSlot(userId, date, 'dinner', rId);
    await mealPlan.add(userId, date, 'dinner', sId, 'manual');

    const list = await rows(householdId);
    const names = list.map((r) => r.name);
    expect(names).not.toContain('r-onion'); // R's unchecked item gone
    expect(names).toContain('r-garlic'); // R's checked item survives
    expect(names).toContain('s-basil'); // S's item present
    expect(names).toContain('napkins'); // manual untouched
    expect(list.find((r) => r.name === 'r-garlic')!.checked).toBe(true);
  });
});

describe('WI-02 TC-4 — the REST path gets sync for free', () => {
  it('POST /v1/meal-plan reconciles the household list with no chef involvement', async () => {
    const { makeHarness } = await import('./helpers/wave2-harness.js');
    const h = await makeHarness();
    try {
      const { token, userId } = await h.mintBearer();
      const householdId = await h.seedHousehold(userId);
      const recipeId = await RecipeRepository.create(h.db).persist(recipeWith('Pasta', [{ name: 'spaghetti' }, { name: 'tomato' }]), userId);

      const res = await h.app.request('/v1/meal-plan', {
        method: 'POST',
        headers: h.auth(token),
        body: JSON.stringify({ entry: { date: planDate(), meal: 'dinner', recipe_id: recipeId } }),
      });
      expect(res.status).toBe(201);

      const list = await GroceryService.create(h.db).list(householdId);
      expect(list.map((r) => r.name).sort()).toEqual(['spaghetti', 'tomato']);
      expect(list.every((r) => r.sourceRecipeId === recipeId)).toBe(true);
    } finally {
      h.cleanup();
    }
  });
});

describe('WI-02 TC-5 — a plan owner with no household', () => {
  it('reconcile no-ops (no rows, no throw)', async () => {
    const [u] = await db.insert(users).values({ imessageHandle: `+1555${String(9000000 + seq++)}`, jwtPrivateKey: '', jwtPublicKey: '' }).returning({ id: users.id });
    await expect(GrocerySync.create(db).reconcile(u!.id)).resolves.toBeUndefined();
    const all = await db.select().from(groceryItems).where(eq(groceryItems.addedByUserId, u!.id));
    expect(all).toHaveLength(0);
  });
});
