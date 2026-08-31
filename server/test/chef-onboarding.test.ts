import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { users, threads, householdMembers, objectives, slots as slotsTable } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ObjectiveStore } from '../src/chef/objective-store.js';
import {
  onboardingObjective,
  householdSlotSpecs,
  memberSlotSpecs,
  ONBOARDING_CLOSE,
} from '../src/chef/objectives/onboarding.js';
import { createSameKitchenHousehold } from '../src/chef/objectives/onboarding-identity.js';

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
  const store = ObjectiveStore.create(db);
  const obj = await store.pushObjective({ threadId, definition: onboardingObjective.id, slots: householdSlotSpecs(), position: 'top' });
  return obj.id;
}

describe('onboarding definition', () => {
  it('seeding creates one household slot row per household-scoped slot (AC-1)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    const rows = await db.select().from(slotsTable).where(eq(slotsTable.objectiveId, objId));
    // Every seeded slot is household-scoped, unasked, member_user_id null.
    expect(rows.every((r) => r.scope === 'household' && r.status === 'unasked' && r.memberUserId === null)).toBe(true);
    expect(rows.map((r) => r.key).sort()).toEqual(householdSlotSpecs().map((s) => s.key).sort());
    // No member-scoped rows until a member exists.
    expect(rows.some((r) => r.scope === 'member')).toBe(false);
  });

  it('the required household set is exactly the design contract (AC-2)', () => {
    const required = onboardingObjective.slots.filter((s) => s.scope === 'household' && s.required).map((s) => s.key).sort();
    expect(required).toEqual(
      ['household.same_household', 'household.grocery_stores', 'household.household_size', 'household.weekly_meals', 'household.cook_days_count'].sort(),
    );
    const requiredMember = onboardingObjective.slots.filter((s) => s.scope === 'member' && s.required).map((s) => s.key).sort();
    expect(requiredMember).toEqual(['allergens', 'name']);
  });

  it('the tool set is exactly the onboarding command tools and no path is scripted (AC-3, AC-7)', () => {
    expect(onboardingObjective.tools).toEqual(['create_household', 'save_household_profile', 'save_member_profile', 'search_catalog']);
    const def = onboardingObjective as unknown as Record<string, unknown>;
    expect(def.steps).toBeUndefined();
    expect(def.path).toBeUndefined();
    expect(def.transitions).toBeUndefined();
    expect(def.cursor).toBeUndefined();
  });

  it('condition-gated guidance covers the allergen, drill-down, off-catalog, and default cases', () => {
    const conditions = onboardingObjective.guidance.map((g) => g.when).join(' | ');
    expect(conditions).toMatch(/allergen/i);
    expect(conditions).toMatch(/broad|like/i);
    expect(conditions).toMatch(/off-catalog/i);
    expect(conditions).toMatch(/unanswered|default/i);
  });
});

describe('same-kitchen identity flow', () => {
  it('creates users, household, memberships, and stamps the thread (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    const { householdId, memberUserIds } = await createSameKitchenHousehold(db, {
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
    const [sh] = await db.select().from(slotsTable).where(and(eq(slotsTable.objectiveId, objId), eq(slotsTable.key, 'household.same_household')));
    expect(sh!.status).toBe('filled');
    expect(sh!.value).toBe(true);
  });

  it('an un-named participant blocks only their own membership + member slots (AC-4)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    const { householdId } = await createSameKitchenHousehold(db, {
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

    const samSlots = await db.select().from(slotsTable).where(eq(slotsTable.memberUserId, sam.id));
    expect(samSlots).toHaveLength(0);
  });

  it('instantiates the member-scoped slots for each identified member (AC-6)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);

    await createSameKitchenHousehold(db, {
      threadId,
      objectiveId: objId,
      participants: [{ handle: '+15551110001', name: 'Priya' }],
    });
    const priya = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110001')))[0]!;

    const rows = await db.select().from(slotsTable).where(eq(slotsTable.memberUserId, priya.id));
    expect(rows.every((r) => r.scope === 'member')).toBe(true);
    expect(rows.map((r) => r.key).sort()).toEqual(['name', 'allergens', 'diets', 'likes', 'dislikes', 'skill_level'].sort());
    expect(rows.filter((r) => r.required).map((r) => r.key).sort()).toEqual(['allergens', 'name']);
  });

  it('is idempotent — a re-run converges (no duplicate users, memberships, or slots)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const input = {
      threadId,
      objectiveId: objId,
      participants: [{ handle: '+15551110001', name: 'Priya' }],
    };
    await createSameKitchenHousehold(db, input);
    const { householdId } = await createSameKitchenHousehold(db, input);

    const priya = (await db.select().from(users).where(eq(users.imessageHandle, '+15551110001')))[0]!;
    const members = await db.select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    // addMember is unique on user_id, so the second household's re-add is a no-op for the member.
    expect(members.filter((m) => m.userId === priya.id)).toHaveLength(1);
    const slots = await db.select().from(slotsTable).where(eq(slotsTable.memberUserId, priya.id));
    expect(slots).toHaveLength(memberSlotSpecs(priya.id).length);
  });
});

describe('completion + close', () => {
  it('isComplete flips true only when every required slot is terminal, then completeAndPop fires (AC-5)', async () => {
    const threadId = await seedThread();
    const objId = await seedOnboarding(threadId);
    const store = ObjectiveStore.create(db);

    // Add one identified member so member-required slots exist too.
    await createSameKitchenHousehold(db, { threadId, objectiveId: objId, participants: [{ handle: '+15551110001', name: 'Priya' }] });

    // Fill/​default every required slot except the member's allergens (leave it asked).
    const required = await db.select().from(slotsTable).where(and(eq(slotsTable.objectiveId, objId), eq(slotsTable.required, true)));
    for (const s of required) {
      if (s.key === 'allergens') {
        await db.update(slotsTable).set({ status: 'asked' }).where(eq(slotsTable.id, s.id));
      } else {
        await db.update(slotsTable).set({ status: 'defaulted' }).where(eq(slotsTable.id, s.id));
      }
    }
    expect(await store.isComplete(objId)).toBe(false);

    // Default the outstanding allergens slot → complete.
    await db.update(slotsTable).set({ status: 'defaulted' }).where(and(eq(slotsTable.objectiveId, objId), eq(slotsTable.key, 'allergens')));
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
