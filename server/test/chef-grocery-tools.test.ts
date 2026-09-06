import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { type Database } from '../src/db.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { GroceryService } from '../src/services/grocery-service.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import {
  resolveNames,
  ViewGroceryTool,
  AddGroceryTool,
  RemoveGroceryTool,
  CheckGroceryTool,
} from '../src/chef/tools/grocery.js';
import { buildTools } from '../src/chef/tools/registry.js';
import { firstMealPlanObjective } from '../src/chef/objectives/first-meal-plan.js';
import type { GroceryItem } from '../src/models/grocery-item.js';
import type { TurnContext } from '../src/chef/tools/types.js';

/**
 * Conversational grocery tools (groceries-chef WI-03): the four resident `grocery__*` tools over the
 * household list, and the O-01 name resolver. Runs against a `file:` libSQL db.
 */

/** A GroceryItem stub for the pure O-01 table test — only the fields the resolver reads matter. */
function row(name: string, over: Partial<GroceryItem> = {}): GroceryItem {
  return { id: randomUUID(), name, amount: null, unit: null, checked: false, ...over } as GroceryItem;
}

describe('O-01 name resolution (TC-1, AC-3/AC-6)', () => {
  const items = [
    row('chicken breast'),
    row('milk'),
    row('eggs'),
  ];

  it('exact name matches', () => {
    const r = resolveNames(items, ['milk']);
    expect(r.matched.map((m) => m.item.name)).toEqual(['milk']);
    expect(r.unmatched).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });

  it('case + plural variant matches ("Eggs" → "eggs")', () => {
    const r = resolveNames(items, ['Eggs']);
    expect(r.matched.map((m) => m.item.name)).toEqual(['eggs']);
  });

  it('substring resolves to a sole match ("the chicken" → "chicken breast")', () => {
    const r = resolveNames(items, ['the chicken']);
    expect(r.matched.map((m) => m.item.name)).toEqual(['chicken breast']);
  });

  it('ambiguous name returns candidates, no match', () => {
    const two = [row('chicken breast'), row('chicken thigh'), row('milk')];
    const r = resolveNames(two, ['chicken']);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0]!.candidates.map((c) => c.name).sort()).toEqual(['chicken breast', 'chicken thigh']);
  });

  it('no match returns unmatched', () => {
    const r = resolveNames(items, ['quinoa']);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toEqual(['quinoa']);
  });
});

let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

async function makeUser(): Promise<string> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const user = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  return user.id;
}

/** Seeds a household + owner and returns a TurnContext wired to it. */
async function seedCtx(): Promise<{ ctx: TurnContext; householdId: string; ownerId: string }> {
  const ownerId = await makeUser();
  const repo = HouseholdRepository.create(db);
  const hh = await repo.createHousehold({ ownerUserId: ownerId });
  await repo.addMember({ householdId: hh.id, userId: ownerId });
  const ctx: TurnContext = {
    threadId: randomUUID(),
    objectiveId: randomUUID(),
    initiatorHandle: '',
    initiatorUserId: ownerId,
    triggerExternalId: null,
    householdId: hh.id,
    members: [{ userId: ownerId }],
    tasks: [],
  };
  return { ctx, householdId: hh.id, ownerId };
}

describe('grocery__add + household merge (TC-2, AC-2)', () => {
  it('adds "2 eggs" onto an existing line of 3 → one row, amount 5; adder recorded', async () => {
    const { ctx, householdId, ownerId } = await seedCtx();
    const service = GroceryService.create(db);
    await service.add(householdId, [{ name: 'eggs', amount: 3, unit: 'count' }]);

    const res = await AddGroceryTool.create(ctx, db).run([{ name: 'eggs', amount: 2, unit: 'count' }]);
    expect(res.added).toEqual([{ name: 'eggs', amount: 5, unit: 'count' }]);

    const list = await service.list(householdId);
    expect(list).toHaveLength(1);
    expect(list[0]!.amount).toBe(5);
    // The first (system) add left added_by null; the tool's merge preserves the row, so assert the
    // tool records the initiator on a fresh insert instead.
    const res2 = await AddGroceryTool.create(ctx, db).run([{ name: 'tortillas', amount: 12 }]);
    expect(res2.added[0]!.name).toBe('tortillas');
    const fresh = (await service.list(householdId)).find((i) => i.name === 'tortillas')!;
    expect(fresh.addedByUserId).toBe(ownerId);
  });
});

describe('grocery__remove / grocery__check act only on certainty (TC-3, AC-3)', () => {
  it('remove "chicken" with two chicken rows → nothing deleted, candidates returned', async () => {
    const { ctx, householdId } = await seedCtx();
    const service = GroceryService.create(db);
    await service.add(householdId, [{ name: 'chicken breast', amount: 2 }, { name: 'chicken thigh', amount: 2 }]);

    const res = await RemoveGroceryTool.create(ctx, db).run(['chicken']);
    expect(res.removed).toEqual([]);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0]!.candidates).toHaveLength(2);
    expect(await service.list(householdId)).toHaveLength(2); // nothing deleted
  });

  it('check "milk" (one row) → checked true', async () => {
    const { ctx, householdId } = await seedCtx();
    const service = GroceryService.create(db);
    await service.add(householdId, [{ name: 'milk', amount: 1, unit: 'carton' }]);

    const res = await CheckGroceryTool.create(ctx, db).run(['milk'], true);
    expect(res.updated).toEqual(['milk']);
    const [item] = await service.list(householdId);
    expect(item!.checked).toBe(true);
  });

  it('remove an unmatched name deletes nothing and reports it', async () => {
    const { ctx, householdId } = await seedCtx();
    const service = GroceryService.create(db);
    await service.add(householdId, [{ name: 'milk', amount: 1 }]);
    const res = await RemoveGroceryTool.create(ctx, db).run(['quinoa']);
    expect(res.removed).toEqual([]);
    expect(res.unmatched).toEqual(['quinoa']);
    expect(await service.list(householdId)).toHaveLength(1);
  });
});

describe('grocery__view (AC-1)', () => {
  it('returns count + items for the household, read-only', async () => {
    const { ctx, householdId } = await seedCtx();
    await GroceryService.create(db).add(householdId, [{ name: 'bread', amount: 1 }]);
    const res = await ViewGroceryTool.create(ctx, db).run();
    expect(res.count).toBe(1);
    expect(res.items[0]).toMatchObject({ name: 'bread', amount: 1, checked: false });
  });

  // WI-04 TC-4: the result carries the grocery-card URL from PUBLIC_APP_URL, undefined when unset
  // (the model then skips the card). Mirrors the plan tool's plan_url.
  it('carries list_url from PUBLIC_APP_URL, undefined when unset', async () => {
    const { ctx, householdId } = await seedCtx();
    const prev = process.env.PUBLIC_APP_URL;
    try {
      process.env.PUBLIC_APP_URL = 'https://app.harvest.example';
      expect((await ViewGroceryTool.create(ctx, db).run()).list_url).toBe(`https://app.harvest.example/g/${householdId}`);
      delete process.env.PUBLIC_APP_URL;
      expect((await ViewGroceryTool.create(ctx, db).run()).list_url).toBeUndefined();
    } finally {
      process.env.PUBLIC_APP_URL = prev;
    }
  });
});

describe('registration + canRun (TC-4, AC-4)', () => {
  it('first_meal_plan builds all four grocery tools', async () => {
    const { ctx } = await seedCtx();
    const built = buildTools(ctx, db, firstMealPlanObjective.tools).map((t) => t.id);
    for (const id of ['grocery__view', 'grocery__add', 'grocery__remove', 'grocery__check']) {
      expect(built).toContain(id);
    }
  });

  it('a no-household context filters the grocery tools out', async () => {
    const { ctx } = await seedCtx();
    const noHousehold: TurnContext = { ...ctx, householdId: null };
    const built = buildTools(noHousehold, db, firstMealPlanObjective.tools).map((t) => t.id);
    expect(built.some((id) => id.startsWith('grocery__'))).toBe(false);
  });
});
