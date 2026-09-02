import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { userAllergens, userDiets, householdPreferences, tasteIngredients, userFoodPrefs, userPreferences, users, fdcFoods } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { seedFdcFixture, SALMON_FDC_ID } from './fixtures/fdc-foods.fixture.js';
import { FactTypeRegistry } from '../src/chef/facts/fact-types.js';
import { FactRegistry } from '../src/chef/facts/registry.js';
import { writeFact } from '../src/chef/facts/write-fact.js';
import type { Subject } from '../src/chef/facts/fact-type.js';

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

async function seedHousehold(): Promise<{ householdId: string; memberId: string; household: Subject; member: Subject; reg: FactTypeRegistry }> {
  const ownerId = await makeUser();
  const repo = HouseholdRepository.create(db);
  const hh = await repo.createHousehold({ ownerUserId: ownerId });
  await repo.addMember({ householdId: hh.id, userId: ownerId });
  return {
    householdId: hh.id,
    memberId: ownerId,
    household: { scope: 'household', householdId: hh.id },
    member: { scope: 'member', userId: ownerId },
    reg: FactTypeRegistry.create(db),
  };
}

// Repo-backed persists open their own transaction, so writeFact runs against the bare `db`
// executor (an outer db.transaction would deadlock libSQL on the nested repo tx).
const type = (reg: FactTypeRegistry, name: string) => reg.get(name)!;

describe('FactRegistry', () => {
  it('covers every onboarding fact with the right scope, and marks household_size derived', () => {
    const keys = FactRegistry.list().map((d) => d.key);
    for (const k of ['household.grocery_stores', 'household.goals', 'household.household_size', 'name', 'allergens', 'diets', 'likes', 'dislikes', 'skill_level'])
      expect(keys).toContain(k);
    expect(FactRegistry.get('household.household_size')!.access).toBe('derived');
    expect(FactRegistry.get('name')!.scope).toBe('member');
  });
});

describe('writeFact — enum (TC-1)', () => {
  it('rejects an illegal skill with closest, persists a legal one', async () => {
    const { member, memberId, reg } = await seedHousehold();
    const t = type(reg, 'SKILL_LEVEL');

    // "adv" prefix-scores advanced below the match floor, so it rejects with it as closest
    // (the shared `coerce` only offers scored candidates — a total miss returns none).
    const bad = await writeFact(t, member, 'adv', db);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.closest).toEqual(expect.arrayContaining(['advanced']));

    const ok = await writeFact(t, member, 'advanced', db);
    expect(ok).toEqual({ ok: true, value: 'advanced' });
    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, memberId));
    expect(row.skillLevel).toBe('advanced');
  });
});

describe('writeFact — scalar (TC-2)', () => {
  it('parses "$120" to 12000 cents', async () => {
    const { household, householdId, reg } = await seedHousehold();
    const res = await writeFact(type(reg, 'WEEKLY_BUDGET_CENTS'), household, '$120', db);
    expect(res).toEqual({ ok: true, value: 12000 });
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.weeklyBudgetCents).toBe(12000);
  });
});

describe('writeFact — catalog (TC-3)', () => {
  it('grounds "trader joes" to its id, rejects off-catalog with closest', async () => {
    const { household, householdId, reg } = await seedHousehold();
    const t = type(reg, 'GROCERY_STORE');

    const ok = await writeFact(t, household, 'trader joes', db);
    expect(ok.ok).toBe(true);
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.groceryStores).toEqual(['trader_joes']);

    const bad = await writeFact(t, household, 'notastore', db);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Array.isArray(bad.closest)).toBe(true);
  });
});

describe('writeFact — allergen rich rule (TC-4)', () => {
  it('rejects with missing[severity,confirmed], persists once confirmed', async () => {
    const { member, memberId, reg } = await seedHousehold();
    const t = type(reg, 'ALLERGEN');

    const bad = await writeFact(t, member, { value: 'peanuts' }, db);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.missing).toEqual(['severity', 'confirmed']);
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(0);

    const ok = await writeFact(t, member, { value: 'peanuts', severity: 'severe', confirmed: true }, db);
    expect(ok.ok).toBe(true);
    const rows = await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId));
    expect(rows).toEqual([expect.objectContaining({ allergen: 'peanut', severity: 'severe' })]);
  });
});

describe('writeFact — derived is read-only (TC-5)', () => {
  it('rejects a write to household_size and writes nothing', async () => {
    const { household, reg } = await seedHousehold();
    const res = await writeFact(type(reg, 'HOUSEHOLD_SIZE'), household, 4, db);
    expect(res).toEqual({ ok: false, reason: 'derived/read-only' });
    expect(await type(reg, 'HOUSEHOLD_SIZE').read(household)).toBe(2); // default 2 adults + 0 kids
  });
});

describe('member read-merge does not wipe siblings', () => {
  it('writing a diet after an allergen keeps the allergen', async () => {
    const { member, memberId, reg } = await seedHousehold();
    await writeFact(type(reg, 'ALLERGEN'), member, { value: 'peanut', severity: 'severe', confirmed: true }, db);
    await writeFact(type(reg, 'DIET'), member, { value: 'vegan', strictness: 'strict' }, db);

    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(1);
    const [diet] = await db.select().from(userDiets).where(eq(userDiets.userId, memberId));
    expect(diet.dietId).toBe('vegan');
  });
});

describe('TC-6 — parity with save_* (reuse the chef-tools input matrix)', () => {
  it('kroger accepts, "piggly wiggly\'s little cousin" rejects with piggly_wiggly closest', async () => {
    const { household, reg } = await seedHousehold();
    const t = type(reg, 'GROCERY_STORE');
    expect((await writeFact(t, household, 'kroger', db)).ok).toBe(true);
    const bad = await writeFact(t, household, "piggly wiggly's little cousin", db);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.closest).toEqual(['piggly_wiggly']);
  });

  it('"$150ish" → 15000', async () => {
    const { household, reg } = await seedHousehold();
    const res = await writeFact(type(reg, 'WEEKLY_BUDGET_CENTS'), household, '$150ish', db);
    expect(res).toEqual({ ok: true, value: 15000 });
  });

  it('"shrimp" → crustacean_shellfish', async () => {
    const { member, reg } = await seedHousehold();
    const res = await writeFact(type(reg, 'ALLERGEN'), member, { value: 'shrimp', severity: 'severe', confirmed: true }, db);
    expect(res).toEqual({ ok: true, value: { allergen: 'crustacean_shellfish', severity: 'severe' } });
  });

  it('an unconfirmed peanut rejects', async () => {
    const { member, reg } = await seedHousehold();
    const res = await writeFact(type(reg, 'ALLERGEN'), member, { value: 'peanut', severity: 'severe' }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.missing).toEqual(['confirmed']);
  });

  it('no_allergens → normalizes to \'none\', writes no row', async () => {
    const { member, memberId, reg } = await seedHousehold();
    const res = await writeFact(type(reg, 'ALLERGEN'), member, { no_allergens: true }, db);
    expect(res).toEqual({ ok: true, value: 'none' });
    expect(await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId))).toHaveLength(0);
  });

  it('an ingredient like grounds "salmon" → the Fish cluster via the tuned matcher', async () => {
    const { member, memberId, reg } = await seedHousehold();
    await seedFdcFixture(db);
    await db.insert(tasteIngredients).values([{ id: 'ti-fish', label: 'Fish', section: 'Meat & Seafood', foodGroup: 10 }]);
    await db.update(fdcFoods).set({ baseIngredientId: 'ti-fish' }).where(eq(fdcFoods.fdcId, SALMON_FDC_ID));

    const res = await writeFact(type(reg, 'TASTE_LIKE'), member, { facet: 'ingredient', value: 'salmon' }, db);
    expect(res.ok).toBe(true);
    const prefs = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, memberId));
    expect(prefs).toContainEqual(expect.objectContaining({ facet: 'ingredient', value: 'ti-fish', sentiment: 'like' }));
  });

  it('a taste value that fails grounding rejects instructively instead of throwing (review #4)', async () => {
    const { member, reg } = await seedHousehold();
    // TasteType.persist throws on a grounding miss; writeFact must convert it to { ok: false }.
    const res = await writeFact(type(reg, 'TASTE_LIKE'), member, { facet: 'ingredient', value: 'zzzznope' }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no catalog match/i);
  });

  it('household goals fan out onto every member\'s users.goals', async () => {
    const { household, memberId, reg } = await seedHousehold();
    await writeFact(type(reg, 'GOAL'), household, 'eat healthier', db);
    const [u] = await db.select().from(users).where(eq(users.id, memberId));
    expect(u.goals).toContain('eat_healthier');
  });
});
