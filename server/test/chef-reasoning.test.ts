import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../src/repositories/household-preference-repository.js';
import { TasteOptionsService } from '../src/services/taste-options-service.js';
import { AuthService } from '../src/services/auth-service.js';
import { threads, householdPreferences } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveStore } from '../src/chef/objective-store.js';
import { prepareBriefing, residentTools, type BriefingInput } from '../src/chef/briefing.js';
import { objectiveDefinition } from '../src/chef/objectives/index.js';
import { ScriptedReasoner, selectReasoningAgent, MastraReasoner } from '../src/chef/reasoning-agent.js';
import { ReplyPlanSchema, SlotUpdateSchema, type ReasoningOutput } from '../src/chef/types.js';
import type { ToolCtx } from '../src/chef/tools/types.js';
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

/**
 * Seeds a thread + household + one member + an active onboarding objective with the given
 * slot statuses, and returns a loaded BriefingInput + a wired ToolCtx (real tools, no network).
 */
async function seedTurn(slotSpecs: { key: string; status: 'unasked' | 'filled' }[]): Promise<{
  input: BriefingInput;
  ctx: ToolCtx;
  memberId: string;
  householdId: string;
}> {
  const ownerId = await makeUser();
  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: ownerId });
  await hh.addMember({ householdId: household.id, userId: ownerId });

  const threadId = randomUUID();
  await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: ownerId, householdId: household.id });

  const store = ObjectiveStore.create(db);
  await store.pushObjective({
    threadId,
    definition: 'onboarding',
    slots: slotSpecs.map((s) => ({ key: s.key, scope: 'household' as const, required: true })),
    position: 'top',
  });
  // Mark the 'filled' ones filled (loadActive returns only unfilled).
  const active = (await store.loadActive(threadId))!;
  for (const spec of slotSpecs.filter((s) => s.status === 'filled')) {
    const slot = active.slots.find((s) => s.key === spec.key)!;
    await db.transaction((tx) => store.applySlotUpdates([{ slotId: slot.id, status: 'filled', value: 'x' }], tx));
  }
  const loaded = (await store.loadActive(threadId))!;

  const state = { householdId: household.id, members: [{ userId: ownerId }] };
  const ctx: ToolCtx = {
    state,
    householdPrefs: HouseholdPreferenceRepository.create(db),
    memberPrefs: PreferenceRepository.create(db),
    taste: TasteOptionsService.create(db),
  };
  const input: BriefingInput = {
    state,
    objective: loaded.objective,
    slots: loaded.slots,
    members: [{ userId: ownerId, name: 'Sam', handle: '+15555580000' }],
    transcript: [{ role: 'household', text: 'we shop at kroger' }],
    trigger: 'we shop at kroger',
  };
  return { input, ctx, memberId: ownerId, householdId: household.id };
}

describe('prepareBriefing (pure L1/L2/L3 assembly)', () => {
  it('AC-5: L1 references only the unfilled slots', async () => {
    const { input } = await seedTurn([
      { key: 'household.cook_days_count', status: 'unasked' },
      { key: 'household.grocery_stores', status: 'unasked' },
      { key: 'household.weekly_budget_cents', status: 'filled' },
    ]);
    const brief = prepareBriefing(input);
    expect(brief.prompt).toContain('household.cook_days_count');
    expect(brief.prompt).toContain('household.grocery_stores');
    expect(brief.prompt).not.toContain('household.weekly_budget_cents');
  });

  it('carries the hard L1 rule and the resident tool set', async () => {
    const { input } = await seedTurn([{ key: 'household.cook_days_count', status: 'unasked' }]);
    const brief = prepareBriefing(input);
    expect(brief.prompt).toContain('never write a value the tools did not return');
    // save_member_profile.canRun is false with no member arg in scope → resident set is the two always-legal tools.
    expect(brief.residentTools.map((e) => e.id)).toEqual(['save_household_profile', 'search_catalog']);
  });

  it('AC-2: a resident tool whose canRun is false is absent from the resident set', async () => {
    const def = objectiveDefinition('onboarding')!;
    // save_member_profile.canRun reads state.args.member_user_id — absent → false.
    const resident = residentTools(def, { householdId: 'h', members: [{ userId: 'u' }], args: { member_user_id: 'ghost' } });
    expect(resident.map((e) => e.id)).not.toContain('save_member_profile');
    expect(resident.map((e) => e.id)).toContain('save_household_profile');
  });
});

describe('ScriptedReasoner (runs real tools, no network)', () => {
  it('AC-1/AC-7: runs the tool, returns a plan that parses; no prose field', async () => {
    const { input, ctx } = await seedTurn([{ key: 'household.cook_days_count', status: 'unasked' }]);
    const plan: ReasoningOutput = {
      replyPlan: { intents: [{ kind: 'confirm', fact: '5 cook days' }], must_say: [] },
      slotUpdates: [{ key: 'household.cook_days_count', status: 'filled' }],
    };
    const reasoner = new ScriptedReasoner([{ toolId: 'save_household_profile', args: { patch: { grocery_stores: ['kroger'] } } }], plan);
    const out = await reasoner.run(input, ctx);

    expect(() => ReplyPlanSchema.parse(out.replyPlan)).not.toThrow();
    expect(() => SlotUpdateSchema.array().parse(out.slotUpdates)).not.toThrow();
    expect(out).not.toHaveProperty('prose');
    // The tool's execute ran (its canRun passed, service called → a row landed).
    const [row] = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, input.state.householdId));
    expect(row.groceryStores).toEqual(['kroger']);
  });

  it('AC-4: an off-catalog value is dropped, not written or confirmed', async () => {
    const { input, ctx } = await seedTurn([{ key: 'household.grocery_stores', status: 'unasked' }]);
    const plan: ReasoningOutput = {
      replyPlan: { intents: [{ kind: 'acknowledge', note: "couldn't place that store" }], must_say: [] },
      slotUpdates: [],
    };
    const reasoner = new ScriptedReasoner(
      [{ toolId: 'save_household_profile', args: { patch: { grocery_stores: ["piggly wiggly's little cousin"] } } }],
      plan,
    );
    const out = await reasoner.run(input, ctx);

    expect(reasoner.results[0].rejected).toContainEqual(expect.objectContaining({ reason: 'no catalog match' }));
    expect(out.slotUpdates.some((u) => u.status === 'filled')).toBe(false);
    expect(out.replyPlan.intents.every((i) => i.kind !== 'confirm')).toBe(true);
    const rows = await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, input.state.householdId));
    expect(rows[0]?.groceryStores ?? []).toEqual([]);
  });

  it('AC-3: a tool withheld from the objective\'s resident set is still reachable', async () => {
    const { input, ctx, memberId } = await seedTurn([{ key: 'member.diets', status: 'unasked' }]);
    // Resident set for this state omits save_member_profile (no member arg). A scripted call still reaches it.
    expect(residentTools(objectiveDefinition('onboarding')!, input.state).map((e) => e.id)).not.toContain('save_member_profile');
    const reasoner = new ScriptedReasoner(
      [{ toolId: 'save_member_profile', args: { member_user_id: memberId, patch: { diets: [{ dietId: 'vegan' }] } } }],
      { replyPlan: { intents: [], must_say: [] }, slotUpdates: [] },
    );
    await reasoner.run(input, ctx);
    expect(reasoner.results[0].saved.diets).toContain('vegan');
  });

  it('an illegal call (canRun false) is never dispatched', async () => {
    const { input, ctx } = await seedTurn([{ key: 'member.diets', status: 'unasked' }]);
    const reasoner = new ScriptedReasoner(
      [{ toolId: 'save_member_profile', args: { member_user_id: 'u-ghost', patch: { diets: [{ dietId: 'vegan' }] } } }],
      { replyPlan: { intents: [], must_say: [] }, slotUpdates: [] },
    );
    await reasoner.run(input, ctx);
    expect(reasoner.results).toHaveLength(0);
  });
});

describe('selectReasoningAgent (env gate, no network)', () => {
  const prev = process.env.DEEPSEEK_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  });

  it('AC-6: absent key → scripted stub; present key → real Mastra agent', () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(selectReasoningAgent()).toBeInstanceOf(ScriptedReasoner);
    process.env.DEEPSEEK_API_KEY = 'test-key-no-network';
    expect(selectReasoningAgent()).toBeInstanceOf(MastraReasoner);
  });
});
