import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { households, householdMembers, users, GOALS } from '../schema.js';

/** A household cooking goal id (the `users.goals` element type). */
type Goal = (typeof GOALS)[number];
import { HouseholdSchema, type Household } from '../models/household.js';

/** A write/read executor: the db singleton or an interactive transaction client. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** The briefing's member list — identity joined from `users`, never denormalized. */
export const HouseholdMemberViewSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().nullable(),
  imessageHandle: z.string().nullable(),
});
export type HouseholdMemberView = z.infer<typeof HouseholdMemberViewSchema>;

/**
 * Data access for `households` and `household_members`. The turn creates a household and
 * adds each identified participant (incl. the owner) idempotently — one household per user
 * in v1, so a re-add is a no-op via the unique `user_id`.
 */
export class HouseholdRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new HouseholdRepository(db);
  }

  /**
   * The household a user belongs to, or null if they have no membership. One indexed lookup
   * on the unique `household_members.user_id` (one household per user, v1) — the single resolver
   * that scopes the grocery REST endpoints and routes the plan-sync reconcile.
   */
  async householdIdForUser(userId: string, tx: Executor = this.db): Promise<string | null> {
    const [row] = await tx
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId))
      .limit(1);
    return row?.householdId ?? null;
  }

  /**
   * Inserts a household owned by `ownerUserId`. Does not auto-add the owner as a member —
   * the caller adds every participant, including the owner, via `addMember`.
   * @returns The household, parsed.
   */
  async createHousehold(input: { ownerUserId: string; name?: string }, tx: Executor = this.db): Promise<Household> {
    const [row] = await tx.insert(households).values({ ownerUserId: input.ownerUserId, name: input.name ?? null }).returning();
    return HouseholdSchema.parse(row);
  }

  /**
   * Links a user to a household, idempotent on the unique `user_id` (one household per user
   * in v1). Re-adding the same user — or a user already in another household — is a no-op.
   */
  async addMember(input: { householdId: string; userId: string }, tx: Executor = this.db): Promise<void> {
    await tx.insert(householdMembers).values(input).onConflictDoNothing({ target: householdMembers.userId });
  }

  /** Links several members to a household in one insert (idempotent on the member's unique user id). */
  async addMembers(householdId: string, userIds: string[], tx: Executor = this.db): Promise<void> {
    if (userIds.length === 0) return;
    await tx
      .insert(householdMembers)
      .values(userIds.map((userId) => ({ householdId, userId })))
      .onConflictDoNothing({ target: householdMembers.userId });
  }

  /** The non-null names of the household's current members — the app-level uniqueness set that
   *  `household__add_members` checks a new name against (name lives on `users`, so there's no DB constraint). */
  async memberNames(householdId: string, tx: Executor = this.db): Promise<string[]> {
    const rows = await tx
      .select({ name: users.name })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId));
    return rows.map((r) => r.name).filter((n): n is string => !!n);
  }

  /**
   * Loads the household's members with their `users` identity (name, iMessage handle),
   * joined — never denormalized onto the link row.
   */
  async loadMembers(householdId: string): Promise<HouseholdMemberView[]> {
    const rows = await this.db
      .select({ userId: users.id, name: users.name, imessageHandle: users.imessageHandle })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId));
    return rows.map((r) => HouseholdMemberViewSchema.parse(r));
  }

  /**
   * Unions one cooking goal onto every member's `users.goals` — the goal set is household-wide, so
   * it fans out to each member (`PreferenceRepository.coldStart` reads it to seed ranking weights).
   * Dedupes per member; a re-add is a no-op.
   * @param householdId - The household whose members receive the goal.
   * @param goal - The goal id to add.
   * @param tx - The executor (the identity/fact write's transaction).
   */
  async addHouseholdGoal(householdId: string, goal: Goal, tx: Executor = this.db): Promise<void> {
    const members = await tx
      .select({ id: users.id, goals: users.goals })
      .from(users)
      .innerJoin(householdMembers, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId));
    for (const m of members) {
      const merged = [...new Set([...(m.goals ?? []), goal])];
      await tx.update(users).set({ goals: merged }).where(eq(users.id, m.id));
    }
  }

  /**
   * The household's cooking goals. Unioned onto every member, so any one member's set represents the
   * household; reads the first member's. Empty when the household has none.
   */
  async householdGoals(householdId: string, tx: Executor = this.db): Promise<Goal[]> {
    const [row] = await tx
      .select({ goals: users.goals })
      .from(users)
      .innerJoin(householdMembers, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId));
    return row?.goals ?? [];
  }
}
