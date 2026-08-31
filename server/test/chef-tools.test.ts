import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { userAllergens, userDiets, householdPreferences, tasteIngredients, userFoodPrefs, userPreferences, users, fdcFoods } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture, SALMON_FDC_ID } from './fixtures/fdc-foods.fixture.js';
import { SaveHouseholdProfileTool } from '../src/chef/tools/save-household-profile.js';
import { SaveHouseholdGoalsTool } from '../src/chef/tools/save-household-goals.js';
import { SaveMemberProfileTool } from '../src/chef/tools/save-member-profile.js';
import { SearchCatalogTool } from '../src/chef/tools/search-catalog.js';
import type { TurnContext } from '../src/chef/tools/types.js';

let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

async function makeUser(): Promise<string> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555557${String(1000 + phoneSeq++).slice(-4)}`;
  const user = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  return user.id;
}

/** Seeds a household with one member and returns the ids + a wired TurnContext. */
async function seedHousehold(): Promise<{ householdId: string; memberId: string; ctx: TurnContext }> {
  const ownerId = await makeUser();
  const repo = HouseholdRepository.create(db);
  const hh = await repo.createHousehold({ ownerUserId: ownerId });
  await repo.addMember({ householdId: hh.id, userId: ownerId });
  const ctx: TurnContext = {
    db,
    threadId: 'thread-test',
    objectiveId: 'obj-test',
    initiatorHandle: '',
    householdId: hh.id,
    members: [{ userId: ownerId }],
  };
  return { householdId: hh.id, memberId: ownerId, ctx };
}

describe('chef tools — canRun (context-only legality)', () => {
  it('save_household_profile.canRun iff a household exists; search_catalog always runs', () => {
    const withHh: TurnContext = { db, threadId: 't', objectiveId: 'o', initiatorHandle: '', householdId: 'h1', members: [] };
    const noHh: TurnContext = { ...withHh, householdId: null };
    expect(SaveHouseholdProfileTool.create(withHh).canRun()).toBe(true);
    expect(SaveHouseholdProfileTool.create(noHh).canRun()).toBe(false);
    expect(SearchCatalogTool.create(noHh).canRun()).toBe(true);
  });

  it('save_member_profile.canRun iff the household has members', () => {
    const withMembers: TurnContext = { db, threadId: 't', objectiveId: 'o', initiatorHandle: '', householdId: 'h1', members: [{ userId: 'u-sam' }] };
    expect(SaveMemberProfileTool.create(withMembers).canRun()).toBe(true);
    expect(SaveMemberProfileTool.create({ ...withMembers, members: [] }).canRun()).toBe(false);
  });
});

describe('save_household_profile.run', () => {
  it('partial-accepts stores: valid saved, unmatched rejected with closest (AC-2)', async () => {
    const { householdId, ctx } = await seedHousehold();
    const res = await SaveHouseholdProfileTool.create(ctx).run({ grocery_stores: ['kroger', "piggly wiggly's little cousin"] });
    expect(res.saved).toEqual({ grocery_stores: ['kroger'] });
    expect(res.rejected).toEqual([
      { input: "piggly wiggly's little cousin", reason: 'no catalog match', closest: ['piggly_wiggly'] },
    ]);
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.groceryStores).toEqual(['kroger']);
  });

  it('coerces "Kroger"→kroger, "instant pot"→pressure_cooker, "$150ish"→15000 (AC-4)', async () => {
    const { ctx } = await seedHousehold();
    const res = await SaveHouseholdProfileTool.create(ctx).run({ grocery_stores: ['Kroger'], owned_equipment: ['instant pot'], weekly_budget_cents: '$150ish' });
    expect(res.saved).toEqual({ grocery_stores: ['kroger'], owned_equipment: ['pressure_cooker'], weekly_budget_cents: 15000 });
    expect(res.rejected).toEqual([]);
  });

  it('treats a null optional as absent — NOT NULL columns survive', async () => {
    const { householdId, ctx } = await seedHousehold();
    const res = await SaveHouseholdProfileTool.create(ctx).run({ grocery_stores: ['kroger'], eats_leftovers: null, household_adults: null });
    expect(res.saved).toEqual({ grocery_stores: ['kroger'] });
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.eatsLeftovers).toBe(true); // column default preserved, not nulled
  });

  it('grounds equipment through the app gazetteer — reaches gear no chef alias map had', async () => {
    const { householdId, ctx } = await seedHousehold();
    // "dutch oven"/"sous vide" were never in the old hand-rolled alias map; the shared gazetteer has them.
    const res = await SaveHouseholdProfileTool.create(ctx).run({ owned_equipment: ['dutch oven', 'sous vide', 'a george foreman thing'] });
    expect(res.saved.owned_equipment).toEqual(['dutch_oven', 'sous_vide']);
    expect(res.rejected).toContainEqual({ input: 'a george foreman thing', reason: 'no catalog match' });
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.ownedEquipment).toEqual(['dutch_oven', 'sous_vide']);
  });
});

describe('save_member_profile.run', () => {
  it('gates allergens on confirmed:true, both directions (AC-3)', async () => {
    const { memberId, ctx } = await seedHousehold();
    const tool = SaveMemberProfileTool.create(ctx);

    const unconfirmed = await tool.run({ member_user_id: memberId, patch: { allergens: [{ allergen: 'peanut', severity: 'severe' }] } });
    expect(unconfirmed.rejected).toContainEqual({ input: 'peanut', reason: 'allergen not confirmed' });
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(0);

    const confirmed = await tool.run({ member_user_id: memberId, patch: { allergens: [{ allergen: 'peanut', severity: 'severe', confirmed: true }] } });
    expect(confirmed.saved.allergens).toContain('peanut');
    const rows = await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId));
    expect(rows).toEqual([expect.objectContaining({ userId: memberId, allergen: 'peanut', severity: 'severe' })]);
  });

  it('coerces "shrimp"→crustacean_shellfish and "veggie"→vegetarian (AC-4)', async () => {
    const { memberId, ctx } = await seedHousehold();
    const res = await SaveMemberProfileTool.create(ctx).run({
      member_user_id: memberId,
      patch: { allergens: [{ allergen: 'shrimp', severity: 'severe', confirmed: true }], diets: [{ dietId: 'veggie' }] },
    });
    expect(res.saved.allergens).toContain('crustacean_shellfish');
    expect(res.saved.diets).toContain('vegetarian');
    const [allergen] = await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId));
    expect(allergen.allergen).toBe('crustacean_shellfish');
    const [diet] = await db.select().from(userDiets).where(eq(userDiets.userId, memberId));
    expect(diet.dietId).toBe('vegetarian');
  });

  it('refuses a write for an absent member, defensively (AC-5)', async () => {
    const { ctx } = await seedHousehold();
    const res = await SaveMemberProfileTool.create(ctx).run({ member_user_id: 'u-ghost', patch: { diets: [{ dietId: 'vegan', strictness: 'strict' }] } });
    expect(res).toEqual({ saved: {}, rejected: [{ input: 'u-ghost', reason: 'member does not exist yet' }] });
  });

  it('is an idempotent set-union: re-running yields one row, same result (AC-6)', async () => {
    const { memberId, ctx } = await seedHousehold();
    const tool = SaveMemberProfileTool.create(ctx);
    const payload = { member_user_id: memberId, patch: { allergens: [{ allergen: 'peanut', severity: 'severe', confirmed: true }] } };
    const first = await tool.run(payload);
    const second = await tool.run(payload);
    expect(second.saved).toEqual(first.saved);
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(1);
  });
});

describe('search_catalog.run (grounds, writes nothing)', () => {
  it('ranks the store match first, grounds a diet synonym, returns the full taste catalog (AC-7)', async () => {
    const { householdId, ctx } = await seedHousehold();
    await db.insert(tasteIngredients).values([{ id: 'ti-okra', label: 'Okra', section: 'Vegetables', foodGroup: 7 }]);
    const before = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    const tool = SearchCatalogTool.create(ctx);

    const stores = await tool.run({ kind: 'store', query: 'krog' });
    expect(stores.candidates[0]).toEqual({ value: 'kroger', label: 'Kroger' });

    const diets = await tool.run({ kind: 'diet', query: 'veggie' });
    expect(diets.candidates.map((c) => c.value)).toContain('vegetarian');

    const taste = await tool.run({ kind: 'taste', query: '' });
    expect(taste.candidates.some((c) => c.value === 'ti-okra')).toBe(true);

    const after = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(after).toEqual(before);
  });

  it('resolves a taste query with no label match through the food matcher (salmon→Fish cluster)', async () => {
    const { ctx } = await seedHousehold();
    await seedFdcFixture(db);
    await db.insert(tasteIngredients).values([{ id: 'ti-fish', label: 'Fish', section: 'Meat & Seafood', foodGroup: 10 }]);
    await db.update(fdcFoods).set({ baseIngredientId: 'ti-fish' }).where(eq(fdcFoods.fdcId, SALMON_FDC_ID));

    // "salmon" is no taste-catalog label, but the matcher rolls it up — grounding must surface it.
    const taste = await SearchCatalogTool.create(ctx).run({ kind: 'taste', query: 'salmon' });
    expect(taste.candidates[0]).toEqual({ value: 'ti-fish', label: 'Fish' });
  });

  it('grounds an equipment query through the gazetteer, not a prefix rank', async () => {
    const { ctx } = await seedHousehold();
    const res = await SearchCatalogTool.create(ctx).run({ kind: 'equipment', query: 'crockpot' });
    expect(res.candidates).toEqual([{ value: 'slow_cooker', label: 'Slow Cooker' }]);
  });
});

describe('save_member_profile.run — food prefs + skill', () => {
  it('grounds an ingredient like via the food matcher (string→FDC→base cluster), echoes labels, sets skill', async () => {
    const { memberId, ctx } = await seedHousehold();
    // Reuse the real ingredient matcher: seed the FDC slice, a "Fish" cluster, and roll salmon up to it.
    await seedFdcFixture(db);
    await db.insert(tasteIngredients).values([{ id: 'ti-fish', label: 'Fish', section: 'Meat & Seafood', foodGroup: 10 }]);
    await db.update(fdcFoods).set({ baseIngredientId: 'ti-fish' }).where(eq(fdcFoods.fdcId, SALMON_FDC_ID));

    const res = await SaveMemberProfileTool.create(ctx).run({
      member_user_id: memberId,
      patch: {
        likes: [{ facet: 'ingredient', value: 'grilled salmon' }], // modifier the old prefix matcher rejected
        dislikes: [{ facet: 'cuisine', value: 'thai' }],
        skill_level: 'advanced',
      },
    });
    // saved echoes display labels (not opaque ids) so the reply can name what landed (fidelity).
    expect(res.saved.likes).toEqual(['Fish']);
    expect((res.saved.dislikes as string[])[0]).toMatch(/thai/i);
    expect(res.saved.skill_level).toBe('advanced');
    const prefs = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, memberId));
    expect(prefs).toContainEqual(expect.objectContaining({ facet: 'ingredient', value: 'ti-fish', sentiment: 'like' }));
    expect(prefs).toContainEqual(expect.objectContaining({ facet: 'cuisine', value: 'thai', sentiment: 'dislike' }));
    const [up] = await db.select().from(userPreferences).where(eq(userPreferences.userId, memberId));
    expect(up.skillLevel).toBe('advanced');
  });

  it('records "no allergies" as none so the required allergens slot can flip, writing no allergen row', async () => {
    const { memberId, ctx } = await seedHousehold();
    const res = await SaveMemberProfileTool.create(ctx).run({ member_user_id: memberId, patch: { no_allergens: true } });
    expect(res.saved.allergens).toBe('none');
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(0);
  });
});

describe('save_household_profile.run — planning fields', () => {
  it('writes weekly meal counts, cook-days, and per-meal time budget', async () => {
    const { householdId, ctx } = await seedHousehold();
    await SaveHouseholdProfileTool.create(ctx).run({ weekly_meals: { dinner: 5 }, cook_days_count: 4, time_by_meal: { dinner: 30 } });
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.weeklyMeals).toEqual({ breakfast: 0, lunch: 0, dinner: 5, snack: 0, kids: 0 });
    // A partial time budget lands now (independent columns) — dinner only.
    expect(row.timeDinnerMinutes).toBe(30);
    expect(row.timeBreakfastMinutes).toBeNull();
    expect(row.timeLunchMinutes).toBeNull();
    expect(row.cookDaysCount).toBe(4);
  });
});

describe('save_household_goals.run', () => {
  it('coerces goals and unions them onto each member users.goals', async () => {
    const { memberId, ctx } = await seedHousehold();
    const res = await SaveHouseholdGoalsTool.create(ctx).run(['eat healthier', 'save money']);
    expect(res.saved).toEqual({ goals: ['eat_healthier', 'save_money'] });
    const [u] = await db.select().from(users).where(eq(users.id, memberId));
    expect(u.goals).toEqual(expect.arrayContaining(['eat_healthier', 'save_money']));
  });
});
