import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { threads } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveRepository } from '../src/chef/objective-repository.js';
import { prepareBriefing, type BriefingInput } from '../src/chef/briefing.js';
import { buildTools } from '../src/chef/tools/registry.js';
import type { TurnContext } from '../src/chef/tools/types.js';
import { randomUUID } from 'node:crypto';

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

/** Seeds a thread + household + one member + an active onboarding objective with the given task statuses. */
async function seedTurn(taskSpecs: { key: string; status: 'unasked' | 'filled' }[]): Promise<{ input: BriefingInput; ctx: TurnContext; memberId: string; householdId: string }> {
  const ownerId = await makeUser();
  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: ownerId });
  await hh.addMember({ householdId: household.id, userId: ownerId });

  const threadId = randomUUID();
  await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: ownerId, householdId: household.id });

  const store = ObjectiveRepository.create(db);
  await store.pushObjective({
    threadId,
    definition: 'onboarding',
    tasks: taskSpecs.map((s) => ({ key: s.key, kind: 'elicit' as const, fact: s.key, scope: 'household' as const, required: true })),
    position: 'top',
  });
  const active = (await store.loadActive(threadId))!;
  for (const spec of taskSpecs.filter((s) => s.status === 'filled')) {
    const task = active.tasks.find((t) => t.fact === spec.key)!;
    await db.transaction((tx) => store.applyTaskUpdates([{ taskId: task.id, status: 'filled' }], tx));
  }
  const loaded = (await store.loadActive(threadId))!;

  const ctx: TurnContext = {
    threadId,
    objectiveId: loaded.objective.id,
    initiatorHandle: '',
    initiatorUserId: ownerId,
    triggerExternalId: null,
    householdId: household.id,
    members: [{ userId: ownerId }],
    tasks: loaded.tasks,
  };
  const input: BriefingInput = {
    objective: loaded.objective,
    tasks: loaded.tasks,
    members: [{ userId: ownerId, name: 'Sam', handle: '+15555580000' }],
    transcript: [{ role: 'household', text: 'we shop at kroger' }],
    trigger: 'we shop at kroger',
  };
  return { input, ctx, memberId: ownerId, householdId: household.id };
}

describe('prepareBriefing (pure prompt assembly)', () => {
  it('references only the unfilled tasks (AC-5)', async () => {
    const { input } = await seedTurn([
      { key: 'household.cook_days_count', status: 'unasked' },
      { key: 'household.grocery_stores', status: 'unasked' },
      { key: 'household.weekly_budget_cents', status: 'filled' },
    ]);
    const prompt = prepareBriefing(input);
    expect(prompt).toContain('household.cook_days_count');
    expect(prompt).toContain('household.grocery_stores');
    expect(prompt).not.toContain('household.weekly_budget_cents');
  });

  it('carries the hard L1 rule', async () => {
    const { input } = await seedTurn([{ key: 'household.cook_days_count', status: 'unasked' }]);
    expect(prepareBriefing(input)).toContain('never write a value the tools did not return');
  });

  it('references the parent message when the trigger is a threaded reply (WI-B TC3)', async () => {
    const { input } = await seedTurn([{ key: 'household.cook_days_count', status: 'unasked' }]);
    const prompt = prepareBriefing({ ...input, replyingTo: 'here is your menu for the week' });
    expect(prompt).toContain('replying to: "here is your menu for the week"');
  });
});

describe('buildTools (per-turn legality gate)', () => {
  it('drops create_household once a household exists; keeps the always-legal tools', async () => {
    const { ctx } = await seedTurn([{ key: 'household.cook_days_count', status: 'unasked' }]);
    const withHh = buildTools(ctx, db, ['create_household', 'read_facts']).map((t) => t.id);
    expect(withHh).toEqual(['read_facts']); // household exists → no create

    const noHh = buildTools({ ...ctx, householdId: null, members: [] }, db, ['create_household', 'read_facts']).map((t) => t.id);
    expect(noHh).toEqual(['create_household', 'read_facts']); // no household → create still offered
  });
});
