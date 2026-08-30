import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { households, householdMembers, users } from '../schema.js';
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
}
