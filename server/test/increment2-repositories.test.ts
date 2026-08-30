import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { users, threads, objectives, slots } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveStore } from '../src/chef/objective-store.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../src/repositories/household-preference-repository.js';

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** Seeds a user (with an iMessage handle), returns its id. */
async function seedUser(handle: string, name?: string): Promise<string> {
  const [u] = await db.insert(users).values({ imessageHandle: handle, name: name ?? null, jwtPrivateKey: '', jwtPublicKey: '' }).returning({ id: users.id });
  return u!.id;
}

/** Seeds a thread owned by a fresh user, returns its id. */
async function seedThread(): Promise<string> {
  const owner = await seedUser(`+1555${Math.random().toString().slice(2, 9)}`);
  const [t] = await db.insert(threads).values({ chatGuid: `chat-${Math.random()}`, ownerUserId: owner }).returning({ id: threads.id });
  return t!.id;
}

/** Inserts an objective row directly, returns its id. */
async function seedObjective(threadId: string, status: 'active' | 'suspended' | 'complete', stackPosition: number): Promise<string> {
  const [o] = await db.insert(objectives).values({ threadId, definition: 'onboard', status, stackPosition }).returning({ id: objectives.id });
  return o!.id;
}

describe('ObjectiveStore', () => {
  it('loadActive returns the active objective + only its unfilled slots, else null (AC-1)', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    await db.insert(slots).values([
      { objectiveId: objId, key: 'a', scope: 'household', required: true, status: 'unasked' },
      { objectiveId: objId, key: 'b', scope: 'household', required: true, status: 'asked' },
      { objectiveId: objId, key: 'c', scope: 'household', required: true, status: 'filled', value: 'x' },
      { objectiveId: objId, key: 'd', scope: 'household', required: true, status: 'defaulted' },
    ]);
    const store = ObjectiveStore.create(db);

    const loaded = await store.loadActive(threadId);
    expect(loaded?.objective.id).toBe(objId);
    expect(loaded?.slots.map((s) => s.key).sort()).toEqual(['a', 'b', 'd']);

    const empty = await store.loadActive(await seedThread());
    expect(empty).toBeNull();
  });

  it('pushObjective positions top/bottom, keeps one active, empty-stack push is active (AC-2)', async () => {
    const threadId = await seedThread();
    const priorActive = await seedObjective(threadId, 'active', 1);
    const store = ObjectiveStore.create(db);

    const top = await store.pushObjective({ threadId, definition: 'digression', slots: [], position: 'top' });
    expect(top.status).toBe('active');
    expect(top.stackPosition).toBe(2);
    const [prior] = await db.select().from(objectives).where(eq(objectives.id, priorActive));
    expect(prior!.status).toBe('suspended');

    const bottom = await store.pushObjective({ threadId, definition: 'background', slots: [], position: 'bottom' });
    expect(bottom.status).toBe('suspended');
    expect(bottom.stackPosition).toBe(0);
    const [stillActive] = await db.select().from(objectives).where(eq(objectives.id, top.id));
    expect(stillActive!.status).toBe('active');

    const fresh = await store.pushObjective({ threadId: await seedThread(), definition: 'first', slots: [], position: 'bottom' });
    expect(fresh.status).toBe('active');
  });

  it('applySlotUpdates enforces filled-requires-value (AC-3)', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    const [s1, s2] = await db
      .insert(slots)
      .values([
        { objectiveId: objId, key: 'a', scope: 'household', required: true, status: 'asked', value: null },
        { objectiveId: objId, key: 'b', scope: 'household', required: true, status: 'asked', value: null },
      ])
      .returning({ id: slots.id });
    const store = ObjectiveStore.create(db);

    await expect(
      db.transaction((tx) => store.applySlotUpdates([{ slotId: s1!.id, status: 'filled' }], tx)),
    ).rejects.toThrow();
    const [unchanged] = await db.select().from(slots).where(eq(slots.id, s1!.id));
    expect(unchanged!.status).toBe('asked');

    await db.transaction((tx) => store.applySlotUpdates([{ slotId: s1!.id, status: 'filled', value: ['gluten'] }], tx));
    const [filled] = await db.select().from(slots).where(eq(slots.id, s1!.id));
    expect(filled!.status).toBe('filled');
    expect(filled!.value).toEqual(['gluten']);

    await db.transaction((tx) => store.applySlotUpdates([{ slotId: s2!.id, status: 'defaulted' }], tx));
    const [defaulted] = await db.select().from(slots).where(eq(slots.id, s2!.id));
    expect(defaulted!.status).toBe('defaulted');
  });

  it('applySlotUpdates fills from a value already stored on the row', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    const [s] = await db
      .insert(slots)
      .values([{ objectiveId: objId, key: 'a', scope: 'household', required: true, status: 'asked', value: 'stored' }])
      .returning({ id: slots.id });
    const store = ObjectiveStore.create(db);

    await db.transaction((tx) => store.applySlotUpdates([{ slotId: s!.id, status: 'filled' }], tx));
    const [filled] = await db.select().from(slots).where(eq(slots.id, s!.id));
    expect(filled!.status).toBe('filled');
  });

  it('completeAndPop completes + activates the next, else empties the stack (AC-4)', async () => {
    const threadId = await seedThread();
    const suspended = await seedObjective(threadId, 'suspended', 1);
    const active = await seedObjective(threadId, 'active', 2);
    const store = ObjectiveStore.create(db);

    const next = await db.transaction((tx) => store.completeAndPop(active, tx));
    expect(next?.id).toBe(suspended);
    expect(next?.status).toBe('active');
    const [completed] = await db.select().from(objectives).where(eq(objectives.id, active));
    expect(completed!.status).toBe('complete');
    expect(completed!.completedAt).toBeInstanceOf(Date);

    const solo = await seedObjective(await seedThread(), 'active', 1);
    const none = await db.transaction((tx) => store.completeAndPop(solo, tx));
    expect(none).toBeNull();
  });

  it('isComplete counts only required non-terminal slots (AC-5)', async () => {
    const threadId = await seedThread();
    const done = await seedObjective(threadId, 'active', 1);
    await db.insert(slots).values([
      { objectiveId: done, key: 'r1', scope: 'household', required: true, status: 'filled', value: 'x' },
      { objectiveId: done, key: 'r2', scope: 'household', required: true, status: 'defaulted' },
      { objectiveId: done, key: 'opt', scope: 'household', required: false, status: 'unasked' },
    ]);
    const open = await seedObjective(threadId, 'suspended', 2);
    await db.insert(slots).values([{ objectiveId: open, key: 'r1', scope: 'household', required: true, status: 'asked' }]);
    const store = ObjectiveStore.create(db);

    expect(await store.isComplete(done)).toBe(true);
    expect(await store.isComplete(open)).toBe(false);
  });
});

describe('HouseholdRepository', () => {
  it('creates a household and adds members idempotently, one per user (AC-6)', async () => {
    const a = await seedUser('+15550000001', 'Ada');
    const b = await seedUser('+15550000002', 'Bo');
    const repo = HouseholdRepository.create(db);

    const household = await repo.createHousehold({ ownerUserId: a });
    expect(household.ownerUserId).toBe(a);

    await repo.addMember({ householdId: household.id, userId: a });
    await repo.addMember({ householdId: household.id, userId: a });
    await repo.addMember({ householdId: household.id, userId: b });

    const members = await repo.loadMembers(household.id);
    expect(members.map((m) => m.userId).sort()).toEqual([a, b].sort());
    expect(members.find((m) => m.userId === a)).toMatchObject({ name: 'Ada', imessageHandle: '+15550000001' });
  });
});

describe('HouseholdPreferenceRepository', () => {
  it('read-merge-write: defaults, then merges successive patches (AC-7)', async () => {
    const owner = await seedUser('+15550000003');
    const household = await HouseholdRepository.create(db).createHousehold({ ownerUserId: owner });
    const repo = HouseholdPreferenceRepository.create(db);

    const defaults = await repo.getPreferences(household.id);
    expect(defaults).toMatchObject({ eatsLeftovers: true, householdAdults: 2, householdKids: 0, cookDaysCount: null, weeklyBudgetCents: null });

    await repo.savePreferences(household.id, { cookDaysCount: 4 });
    const afterFirst = await repo.getPreferences(household.id);
    await new Promise((r) => setTimeout(r, 5));
    await repo.savePreferences(household.id, { weeklyBudgetCents: 15000 });

    const merged = await repo.getPreferences(household.id);
    expect(merged.cookDaysCount).toBe(4);
    expect(merged.weeklyBudgetCents).toBe(15000);
    expect(merged.updatedAt.getTime()).toBeGreaterThanOrEqual(afterFirst.updatedAt.getTime());
  });
});
