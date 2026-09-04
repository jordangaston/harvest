import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { migratedFileDb } from './helpers/migrated-db.js';
import { type Database } from '../src/db.js';
import { users, mealPlanEntries } from '../src/schema.js';
import { RecipeRepository, type RecipeInput } from '../src/repositories/recipe-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../src/repositories/household-preference-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
import { MealPlanGeneratorService } from '../src/planning/generator-service.js';
import { MealPlanService } from '../src/services/meal-plan-service.js';
import type { RecipeCategories } from '../src/models/recipe.js';

/**
 * TC-1..3 — the ported generator over a real corpus: plate-composing generate, the criteria filter +
 * more-options pagination, and entry-level add/remove with a manual pick surviving a regenerate.
 * Offline: a migrated file db, no network.
 */

let db: Database;
let cleanup: () => void;
let seq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

const cats = (o: Partial<RecipeCategories>): RecipeCategories => ({ cuisine: [], mealType: [], dishType: [], primaryIngredient: [], foodCategory: [], ...o });

/** A dinner recipe with the given facets; `min` sets cook time, `owner` the visibility. */
function dinnerRecipe(title: string, c: Partial<RecipeCategories>, min: number): RecipeInput {
  return {
    title,
    sourceType: 'instagram',
    servings: 4,
    servingsEstimated: false,
    totalMinutes: min,
    ingredients: [{ name: 'stuff', amount: '1', unit: 'cup', quantityText: '1 cup stuff' }],
    steps: ['cook'],
    nutrition: null,
    allergens: null,
    categories: cats({ ...c, mealType: ['dinner'] }),
  };
}

async function seedUserAndHousehold(): Promise<{ userId: string; householdId: string }> {
  const [u] = await db.insert(users).values({ imessageHandle: `+1555${String(1000000 + seq++)}`, jwtPrivateKey: '', jwtPublicKey: '' }).returning({ id: users.id });
  const household = await HouseholdRepository.create(db).createHousehold({ ownerUserId: u!.id });
  return { userId: u!.id, householdId: household.id };
}

describe('TC-1 — generate composes plates (main + directive sides)', () => {
  it('fills each dinner slot with a main, and adds a veg side when the main lacks one', async () => {
    const { userId, householdId } = await seedUserAndHousehold();
    const recipes = RecipeRepository.create(db);
    // Two beef mains (no vegetable) + one veg side_dish in the corpus.
    await recipes.persist(dinnerRecipe('Beef Stew', { dishType: ['main_course'], foodCategory: ['red_meat'] }, 40), userId);
    await recipes.persist(dinnerRecipe('Beef Chili', { dishType: ['main_course'], foodCategory: ['red_meat'] }, 45), userId);
    await recipes.persist(dinnerRecipe('Roast Broccoli', { dishType: ['side_dish'], foodCategory: ['vegetable'] }, 20), userId);

    // Household plans 2 dinners; the owner wants a vegetable with every dinner.
    await HouseholdPreferenceRepository.create(db).savePreferences(householdId, { weeklyMeals: { breakfast: 0, lunch: 0, dinner: 2, snack: 0, kids: 0 }, cookDays: ['monday', 'tuesday'] });
    await PreferenceRepository.create(db).upsertFoodPref(userId, { dimension: 'food_category', value: 'vegetable', scope: 'dinner', direction: 'more' });

    const planned = await MealPlanGeneratorService.create(db).generate(userId, householdId, '2026-09-10', '2026-09-16');

    // Two dinner slots, each a beef main + the broccoli side (the main misses the veg rule).
    expect(planned).toHaveLength(2);
    for (const slot of planned) {
      expect(slot.meal).toBe('dinner');
      expect(slot.recipes.map((r) => r.title)).toContain('Roast Broccoli');
      expect(slot.recipes[0]!.title).not.toBe('Roast Broccoli'); // main first, side after
    }

    // Every persisted entry is source 'generated', ordered main-first by position.
    const rows = await db.select().from(mealPlanEntries).where(eq(mealPlanEntries.userId, userId));
    expect(rows.length).toBe(4); // 2 mains + 2 sides
    expect(rows.every((r) => r.source === 'generated')).toBe(true);
  });
});

describe('TC-2 — criteria filter + more-options pagination', () => {
  it('returns only fish ≤30min, then fresh options when the shown ids are excluded', async () => {
    const { userId, householdId } = await seedUserAndHousehold();
    const recipes = RecipeRepository.create(db);
    // Three quick fish + one slow fish + one quick non-fish.
    const fishIds: string[] = [];
    for (const t of ['Fish Tacos', 'Fish Curry', 'Fish Chowder']) fishIds.push(await recipes.persist(dinnerRecipe(t, { dishType: ['main_course'], primaryIngredient: ['fish'] }, 25), userId));
    await recipes.persist(dinnerRecipe('Slow Fish Stew', { dishType: ['main_course'], primaryIngredient: ['fish'] }, 90), userId);
    await recipes.persist(dinnerRecipe('Quick Chicken', { dishType: ['main_course'], primaryIngredient: ['chicken'] }, 20), userId);
    await HouseholdPreferenceRepository.create(db).savePreferences(householdId, { weeklyMeals: { breakfast: 0, lunch: 0, dinner: 3, snack: 0, kids: 0 } });

    const gen = MealPlanGeneratorService.create(db);
    const criteria = { include: { primary_ingredient: ['fish'] }, maxTotalMinutes: 30 };
    const first = await gen.slotOptions(userId, '2026-09-10', 'dinner', { criteria, limit: 3 });

    expect(first.length).toBe(3);
    expect(first.every((o) => fishIds.includes(o.card.id))).toBe(true); // all quick fish, no slow fish, no chicken

    // "More options": exclude the three shown ids — the corpus has no more quick fish, so it's empty.
    const shown = new Set(first.map((o) => o.card.id));
    const second = await gen.slotOptions(userId, '2026-09-10', 'dinner', { criteria, limit: 3, exclude: shown });
    expect(second.every((o) => !shown.has(o.card.id))).toBe(true); // never a repeat
    expect(second.length).toBe(0);
  });
});

describe('TC-3 — entry-level add/remove; a manual pick survives a regenerate', () => {
  it('removes a side, adds a manual replacement, and the manual entry survives generate', async () => {
    const { userId, householdId } = await seedUserAndHousehold();
    const recipes = RecipeRepository.create(db);
    const beefIds = [
      await recipes.persist(dinnerRecipe('Beef Stew', { dishType: ['main_course'], foodCategory: ['red_meat'] }, 40), userId),
      await recipes.persist(dinnerRecipe('Beef Chili', { dishType: ['main_course'], foodCategory: ['red_meat'] }, 45), userId),
    ];
    const sideId = await recipes.persist(dinnerRecipe('Roast Broccoli', { dishType: ['side_dish'], foodCategory: ['vegetable'] }, 20), userId);
    const pickId = await recipes.persist(dinnerRecipe('Garlic Bread', { dishType: ['side_dish'] }, 15), userId);

    await HouseholdPreferenceRepository.create(db).savePreferences(householdId, { weeklyMeals: { breakfast: 0, lunch: 0, dinner: 1, snack: 0, kids: 0 } });
    await PreferenceRepository.create(db).upsertFoodPref(userId, { dimension: 'food_category', value: 'vegetable', scope: 'dinner', direction: 'more' });

    const gen = MealPlanGeneratorService.create(db);
    const mealPlan = MealPlanService.create(db);
    const date = '2026-09-10';
    await gen.generate(userId, householdId, date, '2026-09-16');

    // Remove the generated broccoli side; add garlic bread as a manual pick.
    await mealPlan.removeFromSlot(userId, date, 'dinner', sideId);
    await mealPlan.add(userId, date, 'dinner', pickId, 'manual');

    const afterAdd = await db.select().from(mealPlanEntries).where(and(eq(mealPlanEntries.userId, userId), eq(mealPlanEntries.date, date)));
    expect(afterAdd.some((r) => r.recipeId === sideId)).toBe(false); // side gone
    expect(afterAdd.find((r) => r.recipeId === pickId)?.source).toBe('manual'); // pick is manual
    expect(afterAdd.some((r) => beefIds.includes(r.recipeId))).toBe(true); // the beef main untouched

    // Regenerate the week: the manual garlic-bread pick survives; generated entries are replaced.
    await gen.generate(userId, householdId, date, '2026-09-16');
    const afterRegen = await db.select().from(mealPlanEntries).where(and(eq(mealPlanEntries.userId, userId), eq(mealPlanEntries.date, date)));
    expect(afterRegen.find((r) => r.recipeId === pickId)?.source).toBe('manual');
    expect(afterRegen.some((r) => r.recipeId === pickId)).toBe(true);
  });
});
