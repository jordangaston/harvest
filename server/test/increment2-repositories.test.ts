import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { users, threads, objectives, tasks } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveRepository } from '../src/chef/objective-repository.js';
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

/** An elicit household task spec (fact = key). */
const et = (key: string, required = true, extra: Partial<{ solo: boolean; after: string[] }> = {}) => ({ key, kind: 'elicit' as const, fact: key, scope: 'household' as const, required, ...extra });

describe('ObjectiveRepository', () => {
  it('loadActive returns the active objective + only its non-terminal tasks, else null (AC-1)', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    await db.insert(tasks).values([
      { objectiveId: objId, kind: 'elicit', fact: 'a', scope: 'household', required: true, status: 'unasked' },
      { objectiveId: objId, kind: 'elicit', fact: 'b', scope: 'household', required: true, status: 'asked' },
      { objectiveId: objId, kind: 'elicit', fact: 'c', scope: 'household', required: true, status: 'filled' },
      { objectiveId: objId, kind: 'elicit', fact: 'd', scope: 'household', required: true, status: 'defaulted' },
    ]);
    const store = ObjectiveRepository.create(db);

    const loaded = await store.loadActive(threadId);
    expect(loaded?.objective.id).toBe(objId);
    expect(loaded?.tasks.map((t) => t.fact).sort()).toEqual(['a', 'b']);

    const empty = await store.loadActive(await seedThread());
    expect(empty).toBeNull();
  });

  it('pushObjective positions top/bottom, keeps one active, empty-stack push is active (AC-2)', async () => {
    const threadId = await seedThread();
    const priorActive = await seedObjective(threadId, 'active', 1);
    const store = ObjectiveRepository.create(db);

    const top = await store.pushObjective({ threadId, definition: 'digression', tasks: [], position: 'top' });
    expect(top.status).toBe('active');
    expect(top.stackPosition).toBe(2);
    const [prior] = await db.select().from(objectives).where(eq(objectives.id, priorActive));
    expect(prior!.status).toBe('suspended');

    const bottom = await store.pushObjective({ threadId, definition: 'background', tasks: [], position: 'bottom' });
    expect(bottom.status).toBe('suspended');
    expect(bottom.stackPosition).toBe(0);
    const [stillActive] = await db.select().from(objectives).where(eq(objectives.id, top.id));
    expect(stillActive!.status).toBe('active');

    const fresh = await store.pushObjective({ threadId: await seedThread(), definition: 'first', tasks: [], position: 'bottom' });
    expect(fresh.status).toBe('active');
  });

  it('pushObjective resolves `after` keys to inserted row ids (TC-2)', async () => {
    const threadId = await seedThread();
    const store = ObjectiveRepository.create(db);

    const obj = await store.pushObjective({ threadId, definition: 'onboard', tasks: [et('a'), et('b', true, { after: ['a'] })], position: 'top' });
    expect(obj.stackPosition).toBe(0);
    const rows = await db.select().from(tasks).where(eq(tasks.objectiveId, obj.id));
    const a = rows.find((r) => r.fact === 'a')!;
    const b = rows.find((r) => r.fact === 'b')!;
    expect(b.afterTaskIds).toEqual([a.id]);
    expect(a.afterTaskIds).toEqual([]);
  });

  it('loadActive hides a gated task until its `after` is terminal (TC-3)', async () => {
    const threadId = await seedThread();
    const store = ObjectiveRepository.create(db);
    const obj = await store.pushObjective({ threadId, definition: 'onboard', tasks: [et('a'), et('b', true, { after: ['a'] })], position: 'top' });

    const first = await store.loadActive(threadId);
    expect(first?.tasks.map((t) => t.fact)).toEqual(['a']);

    const aId = first!.tasks[0]!.id;
    await db.transaction((tx) => store.applyTaskUpdates([{ taskId: aId, status: 'filled' }], tx));
    const second = await store.loadActive(threadId);
    expect(second?.tasks.map((t) => t.fact)).toEqual(['b']);
    void obj;
  });

  it('applyTaskUpdates transitions status by id (no value guard)', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    const [t1, t2] = await db
      .insert(tasks)
      .values([
        { objectiveId: objId, kind: 'elicit', fact: 'a', scope: 'household', required: true, status: 'asked' },
        { objectiveId: objId, kind: 'elicit', fact: 'b', scope: 'household', required: true, status: 'asked' },
      ])
      .returning({ id: tasks.id });
    const store = ObjectiveRepository.create(db);

    await db.transaction((tx) => store.applyTaskUpdates([{ taskId: t1!.id, status: 'filled' }], tx));
    const [filled] = await db.select().from(tasks).where(eq(tasks.id, t1!.id));
    expect(filled!.status).toBe('filled');

    await db.transaction((tx) => store.applyTaskUpdates([{ taskId: t2!.id, status: 'defaulted' }], tx));
    const [defaulted] = await db.select().from(tasks).where(eq(tasks.id, t2!.id));
    expect(defaulted!.status).toBe('defaulted');
  });

  it('completeAndPop completes + activates the next, else empties the stack (AC-4)', async () => {
    const threadId = await seedThread();
    const suspended = await seedObjective(threadId, 'suspended', 1);
    const active = await seedObjective(threadId, 'active', 2);
    const store = ObjectiveRepository.create(db);

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

  it('isComplete counts required non-terminal tasks across kinds, then completeAndPop pops (TC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    const [, emit] = await db
      .insert(tasks)
      .values([
        { objectiveId: objId, kind: 'elicit', fact: 'a', scope: 'household', required: true, status: 'filled' },
        { objectiveId: objId, kind: 'emit', fact: null, scope: 'household', required: true, status: 'asked' },
      ])
      .returning({ id: tasks.id });
    const store = ObjectiveRepository.create(db);

    expect(await store.isComplete(objId)).toBe(false);
    await db.transaction((tx) => store.applyTaskUpdates([{ taskId: emit!.id, status: 'filled' }], tx));
    expect(await store.isComplete(objId)).toBe(true);

    const none = await db.transaction((tx) => store.completeAndPop(objId, tx));
    expect(none).toBeNull();
    const [done] = await db.select().from(objectives).where(eq(objectives.id, objId));
    expect(done!.status).toBe('complete');
  });

  it('isComplete counts only required non-terminal tasks (AC-5)', async () => {
    const threadId = await seedThread();
    const done = await seedObjective(threadId, 'active', 1);
    await db.insert(tasks).values([
      { objectiveId: done, kind: 'elicit', fact: 'r1', scope: 'household', required: true, status: 'filled' },
      { objectiveId: done, kind: 'elicit', fact: 'r2', scope: 'household', required: true, status: 'defaulted' },
      { objectiveId: done, kind: 'elicit', fact: 'opt', scope: 'household', required: false, status: 'unasked' },
    ]);
    const open = await seedObjective(threadId, 'suspended', 2);
    await db.insert(tasks).values([{ objectiveId: open, kind: 'elicit', fact: 'r1', scope: 'household', required: true, status: 'asked' }]);
    const store = ObjectiveRepository.create(db);

    expect(await store.isComplete(done)).toBe(true);
    expect(await store.isComplete(open)).toBe(false);
  });

  it('instantiateMemberTasks is idempotent on (objective, fact, member) (TC-5)', async () => {
    const threadId = await seedThread();
    const objId = await seedObjective(threadId, 'active', 1);
    const memberId = await seedUser('+15559990000', 'Mia');
    const store = ObjectiveRepository.create(db);
    const specs = [
      { key: 'allergens', kind: 'elicit' as const, fact: 'allergens', scope: 'member' as const, memberUserId: memberId, required: true },
      { key: 'diets', kind: 'elicit' as const, fact: 'diets', scope: 'member' as const, memberUserId: memberId, required: false },
    ];

    await db.transaction((tx) => store.instantiateMemberTasks(objId, specs, tx));
    await db.transaction((tx) => store.instantiateMemberTasks(objId, specs, tx));

    const rows = await db.select().from(tasks).where(and(eq(tasks.objectiveId, objId), eq(tasks.memberUserId, memberId)));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fact).sort()).toEqual(['allergens', 'diets']);
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
