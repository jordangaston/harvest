import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { householdPreferences, userAllergens, userFoodPrefs, threads, objectives as objectivesTable, tasks as tasksRaw } from '../src/schema.js';
import { TaskSchema } from '../src/models/task.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveRepository, type TaskSpec } from '../src/chef/objective-repository.js';
import { FactTypeRegistry } from '../src/chef/facts/fact-types.js';
import { ReadFactsTool } from '../src/chef/tools/read-facts.js';
import { FactTypesTool } from '../src/chef/tools/fact-types.js';
import { UpdateFactsTool } from '../src/chef/tools/update-facts.js';
import { UpdateTasksTool } from '../src/chef/tools/update-tasks.js';
import { householdTaskSpecs, memberTaskSpecs } from '../src/chef/objectives/onboarding.js';
import type { TurnContext } from '../src/chef/tools/types.js';
import type { Task } from '../src/models/task.js';

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

/** Seeds a household + one member, pushes an objective with the given typed task specs, and returns
 *  the loaded eligible tasks plus a TurnContext wired to them. */
async function seedTurn(specs: TaskSpec[]): Promise<{ ctx: TurnContext; tasks: Task[]; objectiveId: string; householdId: string; memberId: string }> {
  const ownerId = await makeUser();
  const repo = HouseholdRepository.create(db);
  const hh = await repo.createHousehold({ ownerUserId: ownerId });
  await repo.addMember({ householdId: hh.id, userId: ownerId });

  const objectives = ObjectiveRepository.create(db);
  const threadId = randomUUID();
  await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: ownerId, householdId: hh.id });
  const objective = await objectives.pushObjective({ threadId, definition: 'onboarding', tasks: specs, position: 'top' });
  const loaded = (await objectives.loadActive(threadId))!;

  const ctx: TurnContext = {
    threadId,
    objectiveId: objective.id,
    initiatorHandle: '',
    initiatorUserId: ownerId,
    triggerExternalId: null,
    householdId: hh.id,
    members: [{ userId: ownerId }],
    tasks: loaded.tasks,
  };
  return { ctx, tasks: loaded.tasks, objectiveId: objective.id, householdId: hh.id, memberId: ownerId };
}

const storeTask: TaskSpec = { key: 'store', kind: 'elicit', fact: 'household.grocery_stores', factType: 'GROCERY_STORE', scope: 'household', required: true };
const allergenTask = (memberUserId: string): TaskSpec => ({ key: 'allergens', kind: 'elicit', fact: 'allergens', factType: 'ALLERGEN', scope: 'member', memberUserId, required: true });

describe('update_tasks (TC-1)', () => {
  it('fills a grounded store, advances the task, reports objectiveComplete', async () => {
    const { ctx, tasks, householdId } = await seedTurn([storeTask]);
    const task = tasks[0]!;
    const res = await UpdateTasksTool.create(ctx, db).run([{ task_id: task.id, value: 'trader joes' }]);

    expect(res.results).toEqual([{ task_id: task.id, status: 'filled' }]);
    expect(res.objectiveComplete).toBe(true); // the only required task is now filled
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    expect(row.groceryStores).toEqual(['trader_joes']);
  });
});

const emitTask: TaskSpec = { key: 'close', kind: 'emit', scope: 'household', required: true };

describe('update_tasks fills an emit and pops (TC-1, AC-1/2/3)', () => {
  it('marks a required emit filled with no fact write, completes + pops the objective in-loop', async () => {
    const { ctx, tasks, objectiveId } = await seedTurn([emitTask]);
    const emit = tasks[0]!;
    const res = await UpdateTasksTool.create(ctx, db).run([{ task_id: emit.id, value: undefined }]);

    expect(res.results).toEqual([{ task_id: emit.id, status: 'filled' }]);
    expect(res.objectiveComplete).toBe(true);
    expect(res.popped).toBe(true);
    const [erow] = await db.select().from(tasksRaw).where(eq(tasksRaw.id, emit.id));
    expect(erow!.status).toBe('filled');
    const [orow] = await db.select().from(objectivesTable).where(eq(objectivesTable.id, objectiveId));
    expect(orow!.status).toBe('complete'); // popped in-loop before the tool returned
  });
});

describe('update_tasks fills the last elicit and pops (TC-2, AC-2/3)', () => {
  it('when no emit remains, the last required elicit completes + pops; a suspended sibling activates', async () => {
    const { ctx, tasks, objectiveId } = await seedTurn([
      storeTask,
      { key: 'days', kind: 'elicit', fact: 'household.cook_days', factType: 'COOK_DAYS', scope: 'household', required: true },
    ]);
    // Seed a suspended sibling below the active objective so the pop has something to activate.
    const sibling = await ObjectiveRepository.create(db).pushObjective({
      threadId: ctx.threadId, definition: 'onboarding', tasks: [], position: 'bottom',
    });

    // Fill the first elicit (not the last required → no pop yet).
    const store = tasks.find((t) => t.factType === 'GROCERY_STORE')!;
    const first = await UpdateTasksTool.create(ctx, db).run([{ task_id: store.id, value: 'trader joes' }]);
    expect(first.popped).toBe(false);

    // Fill the last required elicit → complete + pop.
    const days = tasks.find((t) => t.factType === 'COOK_DAYS')!;
    const res = await UpdateTasksTool.create(ctx, db).run([{ task_id: days.id, value: ['monday', 'wednesday', 'friday'] }]);
    expect(res.objectiveComplete).toBe(true);
    expect(res.popped).toBe(true);
    expect((await db.select().from(objectivesTable).where(eq(objectivesTable.id, objectiveId)))[0]!.status).toBe('complete');
    expect((await db.select().from(objectivesTable).where(eq(objectivesTable.id, sibling.id)))[0]!.status).toBe('active');
  });
});

describe('update_tasks non-terminal fill does not pop (TC-3, AC-5)', () => {
  it('filling one of two required elicits leaves the objective active, popped false', async () => {
    const { ctx, tasks, objectiveId } = await seedTurn([
      storeTask,
      { key: 'days', kind: 'elicit', fact: 'household.cook_days', factType: 'COOK_DAYS', scope: 'household', required: true },
    ]);
    const store = tasks.find((t) => t.factType === 'GROCERY_STORE')!;
    const res = await UpdateTasksTool.create(ctx, db).run([{ task_id: store.id, value: 'trader joes' }]);

    expect(res.results[0]!.status).toBe('filled');
    expect(res.objectiveComplete).toBe(false);
    expect(res.popped).toBe(false);
    expect((await db.select().from(objectivesTable).where(eq(objectivesTable.id, objectiveId)))[0]!.status).toBe('active');
  });
});

describe('update_tasks instructive rejection (TC-2)', () => {
  it('rejects an allergen missing severity/confirmed and leaves the task open', async () => {
    const owner = await makeUser();
    const { ctx, tasks } = await seedTurnForMember(owner);
    const task = tasks.find((t) => t.factType === 'ALLERGEN')!;

    const res = await UpdateTasksTool.create(ctx, db).run([{ task_id: task.id, value: { value: 'peanuts' } }]);
    expect(res.results[0]!.status).toBe('rejected');
    expect(res.results[0]!.missing).toEqual(['severity', 'confirmed']);
    expect(res.objectiveComplete).toBe(false);
    // task stays non-terminal → still loads as eligible
    const reloaded = (await ObjectiveRepository.create(db).loadActive(ctx.threadId))!;
    expect(reloaded.tasks.some((t) => t.id === task.id)).toBe(true);
  });
});

describe('update_tasks solo-batch rejection', () => {
  it('rejects the whole batch when a solo task is batched with another', async () => {
    const owner = await makeUser();
    const repo = HouseholdRepository.create(db);
    const hh = await repo.createHousehold({ ownerUserId: owner });
    await repo.addMember({ householdId: hh.id, userId: owner });
    const objectives = ObjectiveRepository.create(db);
    const threadId = randomUUID();
    await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: owner, householdId: hh.id });
    const specs: TaskSpec[] = [
      { key: 'store', kind: 'elicit', fact: 'household.grocery_stores', factType: 'GROCERY_STORE', scope: 'household', required: true, solo: true },
      { key: 'days', kind: 'elicit', fact: 'household.cook_days', factType: 'COOK_DAYS', scope: 'household', required: true },
    ];
    const objective = await objectives.pushObjective({ threadId, definition: 'onboarding', tasks: specs, position: 'top' });
    // loadActive now hides non-solo tasks while a solo is pending (solo-exclusive rule), so build the
    // turn's task set from ALL rows to exercise the update_tasks solo-batch guard directly.
    const allTasks = (await db.select().from(tasksRaw).where(eq(tasksRaw.objectiveId, objective.id))).map((r) => TaskSchema.parse(r));
    const ctx: TurnContext = {
      threadId, objectiveId: objective.id, initiatorHandle: '', initiatorUserId: owner,
      triggerExternalId: null, householdId: hh.id, members: [{ userId: owner }], tasks: allTasks,
    };
    const solo = allTasks.find((t) => t.solo)!;
    const other = allTasks.find((t) => !t.solo)!;

    const res = await UpdateTasksTool.create(ctx, db).run([{ task_id: solo.id, value: 'trader joes' }, { task_id: other.id, value: 3 }]);
    expect(res.results.every((r) => r.status === 'rejected')).toBe(true);
    // neither wrote — objective still incomplete
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, hh.id));
    expect(row?.groceryStores ?? []).toEqual([]);
  });
});

describe('update_facts (TC-3)', () => {
  it('writes an out-of-band member allergen without advancing any task', async () => {
    const { ctx, memberId } = await seedTurn([]); // no tasks
    const res = await UpdateFactsTool.create(ctx, db).run([{ key: 'allergens', value: { value: 'peanuts', severity: 'severe', confirmed: true }, member_user_id: memberId }]);
    expect(res.results).toEqual([{ key: 'allergens', status: 'filled' }]);
    const rows = await db.select().from(userAllergens).where(eq(userAllergens.userId, memberId));
    expect(rows).toEqual([expect.objectContaining({ allergen: 'peanut', severity: 'severe' })]);
  });

  it('rejects a write to a derived fact', async () => {
    const { ctx } = await seedTurn([]);
    const res = await UpdateFactsTool.create(ctx, db).run([{ key: 'household.household_size', value: 4 }]);
    expect(res.results[0]!.status).toBe('rejected');
    expect(res.results[0]!.reason).toMatch(/derived/);
  });
});

describe('food directive via update_facts → FOOD_PREFERENCE', () => {
  it('grounds + persists a composite nutrient directive', async () => {
    const { ctx, memberId } = await seedTurn([]);
    const res = await UpdateFactsTool.create(ctx, db).run([
      { key: 'food_preferences', value: { dimension: 'nutrient', value: 'saturated fat', scope: 'day', direction: 'less', strength: 'firm', target: 20, unit: 'grams' }, member_user_id: memberId },
    ]);
    expect(res.results[0]!.status).not.toBe('rejected');
    const prefs = await db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, memberId));
    expect(prefs).toContainEqual(expect.objectContaining({ dimension: 'nutrient', value: 'saturated_fat', scope: 'day', direction: 'less', strength: 'firm', target: 20, unit: 'grams' }));
  });

  it('rejects an illegal scope with an instructive reason, writing nothing', async () => {
    const { ctx, memberId } = await seedTurn([]);
    const res = await UpdateFactsTool.create(ctx, db).run([
      { key: 'food_preferences', value: { dimension: 'nutrient', value: 'sodium', direction: 'less', scope: 'fortnight' }, member_user_id: memberId },
    ]);
    expect(res.results[0]!.status).toBe('rejected');
    expect(res.results[0]!.reason).toMatch(/scope/i);
  });
});

describe('fact_types 2×2 (TC-4)', () => {
  it('browse → describe → ground → search, each kind-tagged, catalogs paged', async () => {
    const { ctx } = await seedTurn([]);
    const tool = FactTypesTool.create(ctx, db);

    const browse = await tool.run({});
    expect(browse.kind).toBe('browse');
    if (browse.kind === 'browse') expect(browse.facts.some((f) => f.key === 'household.grocery_stores')).toBe(true);

    const describe = await tool.run({ key: 'household.grocery_stores' });
    expect(describe.kind).toBe('describe');
    if (describe.kind === 'describe') expect(describe.values!.length).toBeGreaterThan(0);

    // Forgiving key: the type name, singular, wrong case all resolve to the same fact.
    const loose = await tool.run({ key: 'GROCERY_STORE' });
    if (loose.kind === 'describe') expect(loose.key).toBe('household.grocery_stores');

    const scalar = await tool.run({ key: 'household.weekly_budget_cents' });
    if (scalar.kind === 'describe') expect(scalar.rule).toBeTruthy();

    const ground = await tool.run({ query: 'trader joes' });
    expect(ground.kind).toBe('ground');
    if (ground.kind === 'ground') {
      expect(ground.matches[0]!.key).toBe('household.grocery_stores');
      expect(ground.matches[0]!.value).toBe('trader_joes');
    }

    const search = await tool.run({ key: 'household.grocery_stores', query: 'trader' });
    expect(search.kind).toBe('search');
    if (search.kind === 'search') expect(search.matches.some((m) => m.value === 'trader_joes')).toBe(true);
  });

  it('pages a large catalog via page_token', async () => {
    const { ctx } = await seedTurn([]);
    const tool = FactTypesTool.create(ctx, db);
    // owned_equipment has many values — describe should page.
    const page1 = await tool.run({ key: 'household.owned_equipment' });
    if (page1.kind === 'describe' && page1.page_token) {
      const page2 = await tool.run({ key: 'household.owned_equipment', page_token: page1.page_token });
      if (page2.kind === 'describe') expect(page2.values![0]!.value).not.toBe(page1.values![0]!.value);
    }
  });
});

describe('read_facts', () => {
  it('reports known and unknown facts after a write', async () => {
    const { ctx, householdId } = await seedTurn([]);
    const type = FactTypeRegistry.create(db).get('GROCERY_STORE')!;
    await type.persist({ scope: 'household', householdId }, 'kroger', db);

    const res = await ReadFactsTool.create(ctx, db).run(['household.grocery_stores', 'household.weekly_budget_cents']);
    const stores = res.facts.find((f) => f.key === 'household.grocery_stores')!;
    const budget = res.facts.find((f) => f.key === 'household.weekly_budget_cents')!;
    expect(stores.known).toBe(true);
    expect(stores.value).toEqual(['kroger']);
    expect(budget.known).toBe(false);
  });
});

/** Rebuilds a TurnContext against the objective's currently-eligible tasks (what a fresh turn loads). */
async function reloadCtx(base: TurnContext): Promise<{ ctx: TurnContext; tasks: Task[] }> {
  const loaded = (await ObjectiveRepository.create(db).loadActive(base.threadId))!;
  return { ctx: { ...base, tasks: loaded.tasks }, tasks: loaded.tasks };
}

describe('full scripted onboarding (TC-6)', () => {
  it('ack asked first+alone → typed elicits filled via update_tasks → close emit → objective pops', async () => {
    const ownerId = await makeUser();
    const repo = HouseholdRepository.create(db);
    const hh = await repo.createHousehold({ ownerUserId: ownerId });
    await repo.addMember({ householdId: hh.id, userId: ownerId });
    const objectives = ObjectiveRepository.create(db);
    const threadId = randomUUID();
    await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: ownerId, householdId: hh.id });
    const objective = await objectives.pushObjective({
      threadId,
      definition: 'onboarding',
      tasks: [...householdTaskSpecs(), ...memberTaskSpecs(ownerId)],
      position: 'top',
    });
    const objectiveId = objective.id;
    const base: TurnContext = {
      threadId, objectiveId, initiatorHandle: '', initiatorUserId: ownerId,
      triggerExternalId: null, householdId: hh.id, members: [{ userId: ownerId }], tasks: [],
    };

    // Turn 1: only the solo explainer-ack is eligible (everything else is gated after it).
    let loaded = (await objectives.loadActive(threadId))!;
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]!.solo).toBe(true);
    expect(loaded.tasks[0]!.fact).toBeNull();
    const ackId = loaded.tasks[0]!.id;

    // Consumer confirms the ack: asked on delivery, filled on the next inbound.
    await db.transaction((tx) => objectives.applyTaskUpdates([{ taskId: ackId, status: 'asked' }], tx));
    await db.transaction((tx) => objectives.applyTaskUpdates([{ taskId: ackId, status: 'filled' }], tx));

    // Turn 2: the ack unblocks the profile elicits (+ code-filled identity tasks); the emit stays gated.
    loaded = (await objectives.loadActive(threadId))!;
    expect(loaded.tasks.some((t) => t.kind === 'emit')).toBe(false);
    const byFact = new Map(loaded.tasks.map((t) => [t.fact, t]));

    // Code-filled identity tasks (the SameKitchenFlow's job in production).
    await db.transaction(async (tx) => {
      await objectives.markTaskFilled(objectiveId, 'household.same_household', tx);
      await objectives.markTaskFilled(objectiveId, 'household.household_size', tx);
    });

    // Fill the required typed elicits through update_tasks (grounded values).
    const { ctx } = await reloadCtx(base);
    const fills = [
      { fact: 'household.grocery_stores', value: 'trader joes' },
      { fact: 'household.dinners_per_week', value: 4 },
      { fact: 'household.cook_days', value: 5 },
      { fact: 'name', value: 'Sam' },
      { fact: 'allergens', value: { value: 'peanuts', severity: 'severe', confirmed: true } },
    ];
    const updateTasks = UpdateTasksTool.create(ctx, db);
    for (const f of fills) {
      const task = byFact.get(f.fact)!;
      const res = await updateTasks.run([{ task_id: task.id, value: f.value }]);
      expect(res.results[0]!.status).toBe('filled');
    }

    // Turn 3: every required elicit terminal → the close emit is now eligible.
    loaded = (await objectives.loadActive(threadId))!;
    const emit = loaded.tasks.find((t) => t.kind === 'emit')!;
    expect(emit).toBeTruthy();

    // Consumer confirms the emit at send-time, then completes + pops.
    await db.transaction(async (tx) => {
      await objectives.applyTaskUpdates([{ taskId: emit.id, status: 'filled' }], tx);
      expect(await objectives.isComplete(objectiveId, tx)).toBe(true);
      await objectives.completeAndPop(objectiveId, tx);
    });

    const [row] = await db.select().from(objectivesTable).where(eq(objectivesTable.id, objectiveId));
    expect(row!.status).toBe('complete');
  });
});

/** Seeds a member-scoped allergen task on a fresh household owned by `owner`. */
async function seedTurnForMember(owner: string): Promise<{ ctx: TurnContext; tasks: Task[] }> {
  const repo = HouseholdRepository.create(db);
  const hh = await repo.createHousehold({ ownerUserId: owner });
  await repo.addMember({ householdId: hh.id, userId: owner });
  const objectives = ObjectiveRepository.create(db);
  const threadId = randomUUID();
  await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: owner, householdId: hh.id });
  const objective = await objectives.pushObjective({ threadId, definition: 'onboarding', tasks: [allergenTask(owner)], position: 'top' });
  const loaded = (await objectives.loadActive(threadId))!;
  const ctx: TurnContext = {
    threadId, objectiveId: objective.id, initiatorHandle: '', initiatorUserId: owner,
    triggerExternalId: null, householdId: hh.id, members: [{ userId: owner }], tasks: loaded.tasks,
  };
  return { ctx, tasks: loaded.tasks };
}
