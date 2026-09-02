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

/** A fresh thread owned by a fresh user. */
async function seedThread(): Promise<string> {
  const owner = await seedUser(`+1555${Math.random().toString().slice(2, 9)}`);
  const [t] = await db.insert(threads).values({ chatGuid: `chat-${Math.random()}`, ownerUserId: owner }).returning({ id: threads.id });
  return t!.id;
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

    // Every other elicit is gated directly after the ack; the close emit is gated after the required
    // elicits (transitively after the ack). So no task besides the ack is eligible up front.
    const elicits = rows.filter((r) => r.id !== ack.id && r.kind === 'elicit');
    expect(elicits.every((r) => r.afterTaskIds.includes(ack.id))).toBe(true);
    const emit = rows.find((r) => r.kind === 'emit')!;
    expect(emit.afterTaskIds.length).toBeGreaterThan(0);
  });

  it('the close is a required, fact-less emit gated after every required elicit (AC-5)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.objectiveId, objId));

    const emit = rows.find((r) => r.kind === 'emit')!;
    expect(emit.fact).toBeNull();
    expect(emit.required).toBe(true);
    // Gated after the required household elicits (same_household, household_size, grocery_stores,
    // weekly_meals, cook_days_count) — their row ids populate the emit's after_task_ids.
    const requiredElicitIds = rows
      .filter((r) => r.kind === 'elicit' && r.required && r.fact)
      .map((r) => r.id);
    expect(requiredElicitIds.every((id) => emit.afterTaskIds.includes(id))).toBe(true);
  });

  it('the required household set is exactly the design contract (AC-2)', () => {
    const required = householdTaskSpecs().filter((s) => s.scope === 'household' && s.required && s.fact).map((s) => s.fact).sort();
    expect(required).toEqual(
      ['household.same_household', 'household.grocery_stores', 'household.household_size', 'household.weekly_meals', 'household.cook_days_count'].sort(),
    );
    const requiredMember = memberTaskSpecs('m').filter((s) => s.scope === 'member' && s.required).map((s) => s.key).sort();
    expect(requiredMember).toEqual(['allergens', 'name']);
  });

  it('the tool set is exactly the v2 fact surface and no path is scripted (AC-3, AC-7)', () => {
    expect(onboardingObjective.tools).toEqual(['read_facts', 'fact_types', 'update_facts', 'update_tasks', 'create_household', 'import_recipe']);
    const def = onboardingObjective as unknown as Record<string, unknown>;
    expect(def.steps).toBeUndefined();
    expect(def.path).toBeUndefined();
    expect(def.transitions).toBeUndefined();
    expect(def.cursor).toBeUndefined();
  });

  it('elicit tasks carry their fact type so update_tasks can route the fill', () => {
    const stores = householdTaskSpecs().find((s) => s.fact === 'household.grocery_stores')!;
    expect(stores.factType).toBe('GROCERY_STORE');
    const allergens = memberTaskSpecs('m').find((s) => s.key === 'allergens')!;
    expect(allergens.factType).toBe('ALLERGEN');
  });

  it('fill guidance is attached to the tasks it governs, not a separate list', () => {
    const byKey = new Map([...householdTaskSpecs(), ...memberTaskSpecs('m')].map((s) => [s.key, s.guidance]));
    expect(byKey.get('allergens')).toMatch(/severity|no_allergens/i);
    expect(byKey.get('diets')).toMatch(/strict|flexible/i);
    expect(byKey.get('likes')).toMatch(/broad|drill/i);
    // The definition carries no separate one-off guidance list.
    expect((onboardingObjective as unknown as Record<string, unknown>).guidance).toBeUndefined();
  });
});

describe('same-kitchen identity flow', () => {
  it('creates users, household, memberships, and stamps the thread (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    const { householdId, memberUserIds } = await SameKitchenFlow.create(db).establish({
      threadId,
      objectiveId: objId,
      participants: [
        { handle: '+15551110001', name: 'Priya' },
        { handle: '+15551110002', name: 'Sam' },
      ],
    });

    const priya = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110001')))[0]!;
    const sam = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110002')))[0]!;
    expect(priya.name).toBe('Priya');
    expect(sam.name).toBe('Sam');

    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(thread!.householdId).toBe(householdId);

    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members.map((m) => m.userId).sort()).toEqual(memberUserIds.sort());
    expect(members).toHaveLength(2);

    // owner = initiator (first participant, Priya)
    const owner = (await db.select().from(users).where(eq(users.id, priya.id)))[0]!;
    expect(owner.id).toBe(priya.id);

    // same_household slot filled
    const [sh] = await db.select().from(tasksTable).where(and(eq(tasksTable.objectiveId, objId), eq(tasksTable.fact, 'household.same_household')));
    expect(sh!.status).toBe('filled');

    // household_size filled deterministically (the roster count lives in the domain table now)
    const [hs] = await db.select().from(tasksTable).where(and(eq(tasksTable.objectiveId, objId), eq(tasksTable.fact, 'household.household_size')));
    expect(hs!.status).toBe('filled');
  });

  it('an un-named participant blocks only their own membership + member slots (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    const { householdId } = await SameKitchenFlow.create(db).establish({
      threadId,
      objectiveId: objId,
      participants: [
        { handle: '+15551110001', name: 'Priya' },
        { handle: '+15551110009' }, // Sam not yet named
      ],
    });

    // Sam's user row exists (name nullable), but no membership and no member slots for him.
    const sam = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110009')))[0]!;
    expect(sam.name).toBeNull();

    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members).toHaveLength(1);

    const samSlots = await db.select().from(tasksTable).where(eq(tasksTable.memberUserId, sam.id));
    expect(samSlots).toHaveLength(0);
  });

  it('instantiates the member-scoped slots for each identified member (AC-6)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    await SameKitchenFlow.create(db).establish({
      threadId,
      objectiveId: objId,
      participants: [{ handle: '+15551110001', name: 'Priya' }],
    });
    const priya = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110001')))[0]!;

    const rows = await db.select().from(tasksTable).where(eq(tasksTable.memberUserId, priya.id));
    expect(rows.every((r) => r.scope === 'member')).toBe(true);
    expect(rows.map((r) => r.fact).sort()).toEqual(['name', 'allergens', 'diets', 'likes', 'dislikes', 'skill_level'].sort());
    expect(rows.filter((r) => r.required).map((r) => r.fact).sort()).toEqual(['allergens', 'name']);
  });

  it('is idempotent — a re-run converges (no duplicate users, memberships, or slots)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const input = {
      threadId,
      objectiveId: objId,
      participants: [{ handle: '+15551110001', name: 'Priya' }],
    };
    await SameKitchenFlow.create(db).establish(input);
    const { householdId } = await SameKitchenFlow.create(db).establish(input);

    const priya = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110001')))[0]!;
    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    // addMember is unique on user_id, so the second household's re-add is a no-op for the member.
    expect(members.filter((m) => m.userId === priya.id)).toHaveLength(1);
    const memberRows = await db.select().from(tasksTable).where(eq(tasksTable.memberUserId, priya.id));
    expect(memberRows).toHaveLength(memberTaskSpecs(priya.id).length);
  });
});

describe('completion + close', () => {
  it('isComplete flips true only when every required slot is terminal, then completeAndPop fires (AC-5)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const store = ObjectiveRepository.create(db);

    // Add one identified member so member-required slots exist too.
    await SameKitchenFlow.create(db).establish({ threadId, objectiveId: objId, participants: [{ handle: '+15551110001', name: 'Priya' }] });

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

  it('the close plan carries the celebration, drop-a-recipe invite, and first-menu promise', () => {
    const kinds = ONBOARDING_CLOSE.intents.map((i) => i.kind);
    expect(kinds).toContain('confirm'); // celebration / "you're all set"
    expect(kinds).toContain('acknowledge'); // drop a recipe here anytime
    expect(kinds).toContain('hand_off'); // first-menu promise
    const text = JSON.stringify(ONBOARDING_CLOSE).toLowerCase();
    expect(text).toMatch(/recipe/);
    expect(text).toMatch(/menu/);
  });
});
