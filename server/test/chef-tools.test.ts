import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../src/repositories/household-preference-repository.js';
import { TasteOptionsService } from '../src/services/taste-options-service.js';
import { AuthService } from '../src/services/auth-service.js';
import { userAllergens, userDiets, householdPreferences, tasteIngredients } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import * as household from '../src/chef/tools/save-household-profile.js';
import * as member from '../src/chef/tools/save-member-profile.js';
import * as search from '../src/chef/tools/search-catalog.js';
import type { ToolCtx } from '../src/chef/tools/types.js';

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

/** Seeds a household with one member and returns the ids + a wired ToolCtx. */
async function seedHousehold(): Promise<{ householdId: string; memberId: string; ctx: ToolCtx }> {
  const ownerId = await makeUser();
  const repo = HouseholdRepository.create(db);
  const hh = await repo.createHousehold({ ownerUserId: ownerId });
  await repo.addMember({ householdId: hh.id, userId: ownerId });
  const ctx: ToolCtx = {
    state: { householdId: hh.id, members: [{ userId: ownerId }] },
    householdPrefs: HouseholdPreferenceRepository.create(db),
    memberPrefs: PreferenceRepository.create(db),
    taste: TasteOptionsService.create(db),
  };
  return { householdId: hh.id, memberId: ownerId, ctx };
}

describe('chef tools — canRun (pure, no I/O)', () => {
  const state = { householdId: 'h1', members: [{ userId: 'u-sam' }] };

  it('save_household_profile.canRun and search_catalog.canRun are unconditionally true', () => {
    expect(household.canRun(state)).toBe(true);
    expect(search.canRun(state)).toBe(true);
  });

  it('save_member_profile.canRun is true iff the member is in the household', () => {
    expect(member.canRun({ ...state, args: { member_user_id: 'u-sam' } })).toBe(true);
    expect(member.canRun({ ...state, args: { member_user_id: 'u-ghost' } })).toBe(false);
  });
});

describe('save_household_profile.execute', () => {
  it('partial-accepts stores: valid saved, unmatched rejected with closest (AC-2)', async () => {
    const { householdId, ctx } = await seedHousehold();
    const res = await household.execute(
      { patch: { grocery_stores: ['kroger', "piggly wiggly's little cousin"] } },
      ctx,
    );
    expect(res.saved).toEqual({ grocery_stores: ['kroger'] });
    expect(res.rejected).toEqual([
      { input: "piggly wiggly's little cousin", reason: 'no catalog match', closest: ['piggly_wiggly'] },
    ]);
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.groceryStores).toEqual(['kroger']);
  });

  it('coerces "Kroger"→kroger, "instant pot"→pressure_cooker, "$150ish"→15000 (AC-4)', async () => {
    const { ctx } = await seedHousehold();
    const res = await household.execute(
      { patch: { grocery_stores: ['Kroger'], owned_equipment: ['instant pot'], weekly_budget_cents: '$150ish' } },
      ctx,
    );
    expect(res.saved).toEqual({
      grocery_stores: ['kroger'],
      owned_equipment: ['pressure_cooker'],
      weekly_budget_cents: 15000,
    });
    expect(res.rejected).toEqual([]);
  });
});

describe('save_member_profile.execute', () => {
  it('gates allergens on confirmed:true, both directions (AC-3)', async () => {
    const { memberId, ctx } = await seedHousehold();

    const unconfirmed = await member.execute(
      { member_user_id: memberId, patch: { allergens: [{ allergen: 'peanut', severity: 'severe' }] } },
      ctx,
    );
    expect(unconfirmed.rejected).toContainEqual({ input: 'peanut', reason: 'allergen not confirmed' });
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(0);

    const confirmed = await member.execute(
      { member_user_id: memberId, patch: { allergens: [{ allergen: 'peanut', severity: 'severe', confirmed: true }] } },
      ctx,
    );
    expect(confirmed.saved.allergens).toContain('peanut');
    const rows = await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId));
    expect(rows).toEqual([expect.objectContaining({ userId: memberId, allergen: 'peanut', severity: 'severe' })]);
  });

  it('coerces "shrimp"→crustacean_shellfish and "veggie"→vegetarian (AC-4)', async () => {
    const { memberId, ctx } = await seedHousehold();
    const res = await member.execute(
      {
        member_user_id: memberId,
        patch: {
          allergens: [{ allergen: 'shrimp', severity: 'severe', confirmed: true }],
          diets: [{ dietId: 'veggie' }],
        },
      },
      ctx,
    );
    expect(res.saved.allergens).toContain('crustacean_shellfish');
    expect(res.saved.diets).toContain('vegetarian');
    const [allergen] = await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId));
    expect(allergen.allergen).toBe('crustacean_shellfish');
    const [diet] = await db.select().from(userDiets).where(eq(userDiets.userId, memberId));
    expect(diet.dietId).toBe('vegetarian');
  });

  it('refuses a write for an absent member, defensively (AC-5)', async () => {
    const { ctx } = await seedHousehold();
    const res = await member.execute(
      { member_user_id: 'u-ghost', patch: { diets: [{ dietId: 'vegan', strictness: 'strict' }] } },
      ctx,
    );
    expect(res).toEqual({ saved: {}, rejected: [{ input: 'u-ghost', reason: 'member does not exist yet' }] });
  });

  it('is an idempotent set-union: re-running yields one row, same result (AC-6)', async () => {
    const { memberId, ctx } = await seedHousehold();
    const payload = {
      member_user_id: memberId,
      patch: { allergens: [{ allergen: 'peanut', severity: 'severe', confirmed: true }] },
    };
    const first = await member.execute(payload, ctx);
    const second = await member.execute(payload, ctx);
    expect(second.saved).toEqual(first.saved);
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(1);
  });
});

describe('search_catalog.execute (grounds, writes nothing)', () => {
  it('ranks the store match first, grounds a diet synonym, returns the full taste catalog (AC-7)', async () => {
    const { householdId, ctx } = await seedHousehold();
    await db.insert(tasteIngredients).values([{ id: 'ti-okra', label: 'Okra', section: 'Vegetables', foodGroup: 7 }]);
    const before = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));

    const stores = await search.execute({ kind: 'store', query: 'krog' }, ctx);
    expect(stores.candidates[0]).toEqual({ value: 'kroger', label: 'Kroger' });

    const diets = await search.execute({ kind: 'diet', query: 'veggie' }, ctx);
    expect(diets.candidates.map((c) => c.value)).toContain('vegetarian');

    const taste = await search.execute({ kind: 'taste', query: '' }, ctx);
    expect(taste.candidates.some((c) => c.value === 'ti-okra')).toBe(true);

    const after = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(after).toEqual(before);
  });
});
