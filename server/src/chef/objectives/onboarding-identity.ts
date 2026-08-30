import { eq } from 'drizzle-orm';
import type { Database } from '../../db.js';
import { users } from '../../schema.js';
import { ThreadRepository } from '../../repositories/thread-repository.js';
import { HouseholdRepository } from '../../repositories/household-repository.js';
import { ObjectiveStore } from '../objective-store.js';
import { memberSlotSpecs } from './onboarding.js';

/** A drizzle transaction client — the type each write takes inside the identity transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** One participant in the "same kitchen" answer: their iMessage handle and name if given. */
export interface Participant {
  handle: string;
  name?: string;
}

export interface SameKitchenInput {
  threadId: string;
  objectiveId: string;
  /** Every participant; the first is the initiator (recorded as the household owner). */
  participants: Participant[];
}

/**
 * The "same kitchen" identity flow (F-01): turns a room into a household in one transaction.
 * Creates one `users` row per participant keyed by `imessage_handle` (possession proven by the
 * inbound — no OTP), a `households` row owned by the initiator, a `household_members` link and
 * member-scoped slots per *identified* member (one whose name is known), stamps
 * `threads.household_id`, and fills the `household.same_household` slot.
 *
 * No mid-flow synchronization: an un-named participant still gets a `users` row (name nullable)
 * but blocks only their own membership + member slots — everything else writes through now.
 * Idempotent — a re-run converges (users/memberships/slots all upsert on their unique keys).
 *
 * @returns The household id and the member user ids that were linked (the identified ones).
 */
export async function createSameKitchenHousehold(
  db: Database,
  input: SameKitchenInput,
): Promise<{ householdId: string; memberUserIds: string[] }> {
  const threads = ThreadRepository.create(db);
  const households = HouseholdRepository.create(db);
  const objectives = ObjectiveStore.create(db);

  return db.transaction(async (tx) => {
    const withIds = await Promise.all(
      input.participants.map(async (p) => ({ ...p, userId: await upsertUser(threads, tx, p) })),
    );
    const initiator = withIds[0]!;

    // Find-or-create the initiator's household so a re-run converges rather than orphaning one.
    let householdId = await households.findHouseholdIdForUser(initiator.userId, tx);
    if (!householdId) {
      const household = await households.createHousehold({ ownerUserId: initiator.userId }, tx);
      householdId = household.id;
    }
    await threads.stampHousehold(input.threadId, householdId, tx);

    const memberUserIds: string[] = [];
    for (const p of withIds) {
      if (!p.name) continue; // un-named ⇒ no membership, no member slots (blocks only themselves)
      await households.addMember({ householdId, userId: p.userId }, tx);
      await objectives.instantiateMemberSlots(input.objectiveId, memberSlotSpecs(p.userId), tx);
      memberUserIds.push(p.userId);
    }

    await objectives.markSlotFilled(input.objectiveId, 'household.same_household', true, tx);
    return { householdId, memberUserIds };
  });
}

/** Upserts a user by handle and sets their name when it was given. */
async function upsertUser(threads: ThreadRepository, tx: Tx, p: Participant): Promise<string> {
  const userId = await threads.upsertUserByHandle(p.handle, tx);
  if (p.name) await tx.update(users).set({ name: p.name }).where(eq(users.id, userId));
  return userId;
}
