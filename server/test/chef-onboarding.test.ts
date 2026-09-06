import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { users, threads, householdMembers, objectives, tasks as tasksTable } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveRepository } from '../src/chef/objective-repository.js';
import {
  onboardingObjective,
  householdTaskSpecs,
  memberTaskSpecs,
  ONBOARDING_CLOSE,
} from '../src/chef/objectives/onboarding.js';
import { SameKitchenFlow } from '../src/chef/objectives/onboarding-identity.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

async function seedUser(handle: string): Promise<string> {
  const [u] = await db.insert(users).values({ imessageHandle: handle, jwtPrivateKey: '', jwtPublicKey: '' }).returning({ id: users.id });
  return u!.id;
}

/** A fresh thread owned by a fresh user, with its household created + linked (as the webhook does). */
async function seedThread(): Promise<string> {
  const owner = await seedUser(`+1555${Math.random().toString().slice(2, 9)}`);
  const [t] = await db.insert(threads).values({ chatGuid: `chat-${Math.random()}`, ownerUserId: owner }).returning({ id: threads.id });
  const household = await HouseholdRepository.create(db).createHousehold({ ownerUserId: owner });
  await db.update(threads).set({ householdId: household.id }).where(eq(threads.id, t!.id));
  return t!.id;
}

/** The household id linked to a thread (every thread has one once seeded). */
async function householdOf(threadId: string): Promise<string> {
  const [t] = await db.select({ h: threads.householdId }).from(threads).where(eq(threads.id, threadId));
  return t!.h!;
}

/** The thread's owner user id (the person texting — the initiator household__add_members names first). */
async function ownerOf(threadId: string): Promise<string> {
  const [t] = await db.select({ o: threads.ownerUserId }).from(threads).where(eq(threads.id, threadId));
  return t!.o!;
}

/** Seeds the onboarding objective (household slots) on a fresh thread, returns its id. */
async function seedOnboarding(threadId: string): Promise<string> {
  const store = ObjectiveRepository.create(db);
  const obj = await store.pushObjective({ threadId, definition: onboardingObjective.id, tasks: householdTaskSpecs(), position: 'top' });
  return obj.id;
}

describe('onboarding definition', () => {
  it('seeding creates one household task row per household-scoped spec (AC-1)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    const rows = await db.select().from(tasksTable).where(eq(tasksTable.objectiveId, objId));
    // Every seeded task is household-scoped, unasked, member_user_id null.
    expect(rows.every((r) => r.scope === 'household' && r.status === 'unasked' && r.memberUserId === null)).toBe(true);
    // fact is null for the explainer-ack + close emit; the rest carry their fact key.
    expect(rows.map((r) => r.fact ?? null).filter((f): f is string => !!f).sort()).toEqual(
      householdTaskSpecs().map((s) => s.fact).filter((f): f is string => !!f).sort(),
    );
    // No member-scoped rows until a member exists.
    expect(rows.some((r) => r.scope === 'member')).toBe(false);
  });

  it('the explainer-ack is a solo, fact-less elicit asked first, gating every other task (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.objectiveId, objId));

    const ack = rows.find((r) => r.solo)!;
    expect(ack.kind).toBe('elicit');
    expect(ack.fact).toBeNull(); // no domain fact — confirmed by the next inbound, not a tool
    expect(ack.afterTaskIds).toEqual([]); // nothing gates the ack — it runs first

    // Gating is enforced by the solo-exclusive eligibility rule, not per-task `after` edges: while the
    // required solo ack is non-terminal, loadActive offers ONLY solo tasks, so nothing else is asked first.
    const store = ObjectiveRepository.create(db);
    const upFront = (await store.loadActive(threadId))!.tasks;
    expect(upFront.some((t) => t.id === ack.id)).toBe(true);
    expect(upFront.every((t) => t.solo)).toBe(true);
    // Once the ack is acknowledged (terminal), the rest of the elicits open up.
    await db.update(tasksTable).set({ status: 'filled' }).where(eq(tasksTable.id, ack.id));
    const afterAck = (await store.loadActive(threadId))!.tasks;
    expect(afterAck.length).toBeGreaterThan(1);
    expect(afterAck.some((t) => t.id === ack.id)).toBe(false);
  });

  it('the close is a required, fact-less emit gated after every required elicit (AC-5)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.objectiveId, objId));

    const emit = rows.find((r) => r.kind === 'emit')!;
    expect(emit.fact).toBeNull();
    expect(emit.required).toBe(true);
    // Gated after the required household elicits (same_household, household_size, grocery_stores,
    // weekly_meals, cook_days) — their row ids populate the emit's after_task_ids.
    const requiredElicitIds = rows
      .filter((r) => r.kind === 'elicit' && r.required && r.fact)
      .map((r) => r.id);
    expect(requiredElicitIds.every((id) => emit.afterTaskIds.includes(id))).toBe(true);
  });

  it('the required household set is exactly the design contract (AC-2)', () => {
    const required = householdTaskSpecs().filter((s) => s.scope === 'household' && s.required && s.fact).map((s) => s.fact).sort();
    expect(required).toEqual(
      ['household.same_household', 'household.grocery_stores', 'household.household_size', 'household.dinners_per_week', 'household.cook_days'].sort(),
    );
    const requiredMember = memberTaskSpecs('m').filter((s) => s.scope === 'member' && s.required).map((s) => s.key).sort();
    expect(requiredMember).toEqual(['allergens', 'name']);
  });

  it('the tool set is the v2 fact surface + groceries and no path is scripted (AC-3, AC-7)', () => {
    // Groceries are resident during onboarding so a mid-onboarding "add milk" works (chef-steady-state WI-01 AC-5).
    expect(onboardingObjective.tools).toEqual(['facts__read', 'facts__catalog', 'facts__update', 'tasks__update', 'household__add_members', 'recipes__import', 'grocery__view', 'grocery__add', 'grocery__remove', 'grocery__check']);
    const def = onboardingObjective as unknown as Record<string, unknown>;
    expect(def.steps).toBeUndefined();
    expect(def.path).toBeUndefined();
    expect(def.transitions).toBeUndefined();
    expect(def.cursor).toBeUndefined();
  });

  it('elicit tasks carry their fact type so tasks__update can route the fill', () => {
    const stores = householdTaskSpecs().find((s) => s.fact === 'household.grocery_stores')!;
    expect(stores.factType).toBe('GROCERY_STORE');
    const allergens = memberTaskSpecs('m').find((s) => s.key === 'allergens')!;
    expect(allergens.factType).toBe('ALLERGEN');
  });

  it('fill guidance is attached to the tasks it governs, not a separate list', () => {
    const byKey = new Map([...householdTaskSpecs(), ...memberTaskSpecs('m')].map((s) => [s.key, s.guidance]));
    expect(byKey.get('allergens')).toMatch(/severity|no_allergens/i);
    expect(byKey.get('diets')).toMatch(/strict|flexible/i);
    expect(byKey.get('food_preferences')).toMatch(/broad|drill/i);
    // The definition carries no separate one-off guidance list.
    expect((onboardingObjective as unknown as Record<string, unknown>).guidance).toBeUndefined();
  });
});

describe('same-kitchen roster flow', () => {
  it('adds members, names the texter own user first, marks the roster slots (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const householdId = await householdOf(threadId);
    const ownerId = await ownerOf(threadId);

    const { results, addedUserIds } = await SameKitchenFlow.create(db).addMembers({
      householdId,
      initiatorUserId: ownerId,
      objectiveId: objId,
      names: ['Priya', 'Sam'],
    });
    expect(results.map((r) => r.status)).toEqual(['added', 'added']);

    // The first name claims the texter's own (owner) user; the second is a name-only proxy.
    const owner = (await db.select().from(users).where(eq(users.id, ownerId)))[0]!;
    expect(owner.name).toBe('Priya');
    const sam = (await db.select().from(users).where(eq(users.name, 'Sam')))[0]!;
    expect(sam.id).not.toBe(ownerId);

    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members.map((m) => m.userId).sort()).toEqual([...addedUserIds].sort());
    expect(members).toHaveLength(2);

    const [sh] = await db.select().from(tasksTable).where(and(eq(tasksTable.objectiveId, objId), eq(tasksTable.fact, 'household.same_household')));
    expect(sh!.status).toBe('filled');
    const [hs] = await db.select().from(tasksTable).where(and(eq(tasksTable.objectiveId, objId), eq(tasksTable.fact, 'household.household_size')));
    expect(hs!.status).toBe('filled');
  });

  it('rejects a duplicate name so the chef can ask for a nickname (idempotent by name)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const householdId = await householdOf(threadId);
    const ownerId = await ownerOf(threadId);
    const flow = SameKitchenFlow.create(db);

    await flow.addMembers({ householdId, initiatorUserId: ownerId, objectiveId: objId, names: ['Jordan'] });
    const { results, addedUserIds } = await flow.addMembers({ householdId, initiatorUserId: ownerId, objectiveId: objId, names: ['Jordan'] });

    expect(addedUserIds).toHaveLength(0);
    expect(results[0]!.status).toBe('rejected');
    expect(results[0]!.reason).toMatch(/nickname/i);
    // Still exactly one member named Jordan — the re-add did not duplicate.
    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members).toHaveLength(1);
  });

  it('adds a later joiner as a proxy without disturbing the texter (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const householdId = await householdOf(threadId);
    const ownerId = await ownerOf(threadId);
    const flow = SameKitchenFlow.create(db);

    await flow.addMembers({ householdId, initiatorUserId: ownerId, objectiveId: objId, names: ['Priya'] });
    await flow.addMembers({ householdId, initiatorUserId: ownerId, objectiveId: objId, names: ['Alex'] });

    // The owner stays Priya; Alex is a distinct proxy user, never the texter.
    const owner = (await db.select().from(users).where(eq(users.id, ownerId)))[0]!;
    expect(owner.name).toBe('Priya');
    const alex = (await db.select().from(users).where(eq(users.name, 'Alex')))[0]!;
    expect(alex.id).not.toBe(ownerId);

    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members).toHaveLength(2);
  });

  it('instantiates the member-scoped slots for each added member (AC-6)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const ownerId = await ownerOf(threadId);

    await SameKitchenFlow.create(db).addMembers({
      householdId: await householdOf(threadId),
      initiatorUserId: ownerId,
      objectiveId: objId,
      names: ['Priya'],
    });

    const rows = await db.select().from(tasksTable).where(eq(tasksTable.memberUserId, ownerId));
    expect(rows.every((r) => r.scope === 'member')).toBe(true);
    expect(rows.map((r) => r.fact).sort()).toEqual(['name', 'allergens', 'diets', 'food_preferences', 'skill_level'].sort());
    expect(rows.filter((r) => r.required).map((r) => r.fact).sort()).toEqual(['allergens', 'name']);
  });
});

describe('completion + close', () => {
  it('isComplete flips true only when every required slot is terminal, then completeAndPop fires (AC-5)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const store = ObjectiveRepository.create(db);

    // Add one identified member so member-required slots exist too.
    await SameKitchenFlow.create(db).addMembers({ householdId: await householdOf(threadId), initiatorUserId: await ownerOf(threadId), objectiveId: objId, names: ['Priya'] });

    // Fill/​default every required task except the member's allergens (leave it asked). The close
    // emit + explainer-ack are required too — default them here.
    const required = await db.select().from(tasksTable).where(and(eq(tasksTable.objectiveId, objId), eq(tasksTable.required, true)));
    for (const s of required) {
      if (s.fact === 'allergens') {
        await db.update(tasksTable).set({ status: 'asked' }).where(eq(tasksTable.id, s.id));
      } else {
        await db.update(tasksTable).set({ status: 'defaulted' }).where(eq(tasksTable.id, s.id));
      }
    }
    expect(await store.isComplete(objId)).toBe(false);

    // Default the outstanding allergens slot → complete.
    await db.update(tasksTable).set({ status: 'defaulted' }).where(and(eq(tasksTable.objectiveId, objId), eq(tasksTable.fact, 'allergens')));
    expect(await store.isComplete(objId)).toBe(true);

    await db.transaction((tx) => store.completeAndPop(objId, tx));
    const [row] = await db.select().from(objectives).where(eq(objectives.id, objId));
    expect(row!.status).toBe('complete');
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  it('the close result carries the celebration, drop-a-recipe invite, and first-menu promise', () => {
    expect(ONBOARDING_CLOSE).toHaveLength(3); // celebration, drop-a-recipe, first-menu
    const text = JSON.stringify(ONBOARDING_CLOSE).toLowerCase();
    expect(text).toMatch(/set/); // "you're all set" celebration
    expect(text).toMatch(/recipe/);
    expect(text).toMatch(/menu/);
  });
});
