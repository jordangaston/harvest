import type { Database } from '../../db.js';
import { ThreadRepository } from '../../repositories/thread-repository.js';
import { HouseholdRepository } from '../../repositories/household-repository.js';
import { UserRepository } from '../../repositories/user-repository.js';
import { ObjectiveRepository } from '../objective-repository.js';
import { memberTaskSpecs } from './onboarding.js';

/** A drizzle transaction client — the type each write takes inside the identity transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** One participant in the "same kitchen" answer. The initiator has a handle (they texted);
 *  a proxy member named by someone else may have only a name (no handle yet). */
export interface Participant {
  handle?: string;
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
 * member-scoped slots per *identified* member (one whose name is known), links the thread to the
 * household, and fills the `household.same_household`/`household_size` slots.
 *
 * No mid-flow synchronization: an un-named participant still gets a `users` row (name nullable)
 * but blocks only their own membership + member slots — everything else writes through now.
 * Idempotent — a re-run converges (users/memberships/slots all upsert on their unique keys).
 */
export class SameKitchenFlow {
  private constructor(
    private readonly db: Database,
    private readonly threads: ThreadRepository,
    private readonly households: HouseholdRepository,
    private readonly users: UserRepository,
    private readonly objectives: ObjectiveRepository,
  ) {}

  static create(db: Database): SameKitchenFlow {
    return new SameKitchenFlow(
      db,
      ThreadRepository.create(db),
      HouseholdRepository.create(db),
      UserRepository.create(db),
      ObjectiveRepository.create(db),
    );
  }

  /**
   * Establishes the household from a "same kitchen" answer.
   * @returns The household id and the member user ids that were linked (the identified ones).
   */
  async establish(input: SameKitchenInput): Promise<{ householdId: string; memberUserIds: string[] }> {
    return this.db.transaction(async (tx) => {
      const withIds = await Promise.all(
        input.participants.map(async (p) => ({ ...p, userId: await this.resolveUser(tx, p) })),
      );
      const initiator = withIds[0]!;

      // Find-or-create the initiator's household so a re-run converges rather than orphaning one.
      let householdId = await this.households.findHouseholdIdForUser(initiator.userId, tx);
      if (!householdId) householdId = (await this.households.createHousehold({ ownerUserId: initiator.userId }, tx)).id;
      await this.threads.linkHousehold(input.threadId, householdId, tx);

      // Only identified members (name known) get a membership + slots — both bulk-inserted, no N+1.
      const identified = withIds.filter((p) => p.name);
      await this.households.addMembers(householdId, identified.map((p) => p.userId), tx);
      await this.objectives.instantiateMemberTasks(input.objectiveId, identified.flatMap((p) => memberTaskSpecs(p.userId)), tx);

      await this.objectives.markTaskFilled(input.objectiveId, 'household.same_household', tx);
      // household_size is the roster count — derivable here, so fill it deterministically rather
      // than leaving the model to volunteer a taskUpdate for a task no tool grounds.
      await this.objectives.markTaskFilled(input.objectiveId, 'household.household_size', tx);
      return { householdId, memberUserIds: identified.map((p) => p.userId) };
    });
  }

  /** A participant's user id: by handle if they've texted (name refreshed), else a fresh proxy row
   *  whose id the database assigns — no hand-rolled uuid, the column default + `returning()` supply it. */
  private async resolveUser(tx: Tx, p: Participant): Promise<string> {
    if (p.handle) {
      const userId = await this.threads.upsertUserByHandle(p.handle, tx);
      if (p.name) await this.users.setName(userId, p.name, tx);
      return userId;
    }
    const user = await this.users.insert({ name: p.name ?? null, jwtPrivateKey: '', jwtPublicKey: '' }, tx);
    return user.id;
  }
}
