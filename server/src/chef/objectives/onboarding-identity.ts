import type { Database } from '../../db.js';
import { HouseholdRepository } from '../../repositories/household-repository.js';
import { UserRepository } from '../../repositories/user-repository.js';
import { ObjectiveRepository } from '../objective-repository.js';
import { memberTaskSpecs } from './onboarding.js';

export interface AddMembersInput {
  /** The household the members join — created with the thread on first inbound. */
  householdId: string;
  /** The thread owner (the person texting) — named as the first member of a brand-new household. */
  initiatorUserId: string;
  objectiveId: string;
  /** The member names to add this call — new people only; a name already present is rejected. */
  names: string[];
}

/** One name's verdict: added (with the user it became) or rejected (with why). */
export interface MemberAddResult {
  name: string;
  status: 'added' | 'rejected';
  reason?: string;
  userId?: string;
}

/**
 * The "same kitchen" roster flow (F-01): adds named members to the thread's household. Names are
 * unique within a household (app-level, checked at this single chokepoint) — a duplicate is rejected
 * so the chef can ask for a nickname. The first member of a brand-new household names the texter's
 * own `users` row (which already carries their handle from the inbound); every later member is a
 * name-only proxy row (until they text and identity-link, increment 2). Each added member gets its
 * member-scoped slots; the first successful add fills `household.same_household`/`household_size`.
 *
 * Idempotent by name: re-adding an existing member is a no-op rejection, not a duplicate.
 */
export class SameKitchenFlow {
  private constructor(
    private readonly db: Database,
    private readonly households: HouseholdRepository,
    private readonly users: UserRepository,
    private readonly objectives: ObjectiveRepository,
  ) {}

  static create(db: Database): SameKitchenFlow {
    return new SameKitchenFlow(
      db,
      HouseholdRepository.create(db),
      UserRepository.create(db),
      ObjectiveRepository.create(db),
    );
  }

  /**
   * Adds the given names to the household as members.
   * @returns Each name's verdict and the user ids that were added this call.
   */
  async addMembers(input: AddMembersInput): Promise<{ results: MemberAddResult[]; addedUserIds: string[] }> {
    return this.db.transaction(async (tx) => {
      const taken = new Set((await this.households.memberNames(input.householdId, tx)).map((n) => n.toLowerCase()));
      // The texter claims their own (handle-bearing) user only on a brand-new household, listing
      // themselves first; after that every name is a proxy — so a late joiner never takes the handle.
      let ownerUnclaimed = taken.size === 0;

      const results: MemberAddResult[] = [];
      const addedUserIds: string[] = [];
      for (const raw of input.names) {
        const name = raw.trim();
        if (taken.has(name.toLowerCase())) {
          results.push({ name, status: 'rejected', reason: `already a member named ${name} — try a nickname` });
          continue;
        }

        let userId: string;
        if (ownerUnclaimed) {
          await this.users.setName(input.initiatorUserId, name, tx);
          userId = input.initiatorUserId;
          ownerUnclaimed = false;
        } else {
          userId = (await this.users.insert({ name, jwtPrivateKey: '', jwtPublicKey: '' }, tx)).id;
        }
        await this.households.addMember({ householdId: input.householdId, userId }, tx);
        await this.objectives.instantiateMemberTasks(input.objectiveId, memberTaskSpecs(userId), tx);
        taken.add(name.toLowerCase());
        results.push({ name, status: 'added', userId });
        addedUserIds.push(userId);
      }

      if (addedUserIds.length > 0) {
        await this.objectives.markTaskFilled(input.objectiveId, 'household.same_household', tx);
        // household_size is the roster count — derivable, so fill it here rather than leaving the
        // model to volunteer a taskUpdate for a task no tool grounds.
        await this.objectives.markTaskFilled(input.objectiveId, 'household.household_size', tx);
      }
      return { results, addedUserIds };
    });
  }
}
