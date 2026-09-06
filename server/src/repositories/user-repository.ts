import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, recipes, cookbooks, importJobs, mealPlanEntries, type NewUser } from '../schema.js';
import { UserSchema, type User } from '../models/user.js';

/** A write/read executor: the db singleton or an interactive transaction client. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

export class UserRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. (S1 has no env-configured singleton yet; a
   * later story adds `db` as a shared singleton and drops the argument.) */
  static create(db: Database) {
    return new UserRepository(db);
  }

  /**
   * Looks up a user by phone number.
   * @param phone - Phone to match.
   * @returns The user parsed into the domain model, or null if none.
   */
  async findByPhone(phone: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.phone, phone));
    return row ? UserSchema.parse(row) : null;
  }

  /**
   * Looks up an anonymous user by their device key.
   * @param deviceKey - The device key to match.
   * @returns The user parsed into the domain model, or null if none.
   */
  async findByDeviceKey(deviceKey: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.deviceKey, deviceKey));
    return row ? UserSchema.parse(row) : null;
  }

  /**
   * Looks up a user by id.
   * @param id - User id.
   * @returns The user parsed into the domain model, or null if none.
   */
  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? UserSchema.parse(row) : null;
  }

  /**
   * Inserts a new user row.
   * @param values - Phone, the user's JWT key pair, and optional typed onboarding columns.
   * @returns The inserted row, parsed into the domain model.
   */
  async insert(values: NewUser, tx: Executor = this.db): Promise<User> {
    const [row] = await tx.insert(users).values(values).returning();
    return UserSchema.parse(row);
  }

  /** Sets a user's display name (used when a member texts under a handle we already have). */
  async setName(id: string, name: string, tx: Executor = this.db): Promise<void> {
    await tx.update(users).set({ name }).where(eq(users.id, id));
  }

  /**
   * Permanently deletes a user and every row they own, in one transaction.
   *
   * Order respects the foreign keys: `import_jobs` and `meal_plan_entries` go before
   * `recipes`; `recipes` then cascades its ingredients, steps, and join rows; `cookbooks`
   * and the user row follow. `grocery_items` is NOT deleted — the list belongs to the
   * household, not the user (the user's `added_by_user_id` attribution FK is `set null`).
   *
   * @param userId - The user to delete (the authenticated caller).
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(importJobs).where(eq(importJobs.userId, userId));
      await tx.delete(mealPlanEntries).where(eq(mealPlanEntries.userId, userId));
      await tx.delete(recipes).where(eq(recipes.userId, userId));
      await tx.delete(cookbooks).where(eq(cookbooks.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
  }

  /**
   * Bumps a nonce, revoking every token in that family.
   * @param id - User whose nonce to bump.
   * @param kind - Which token family to revoke: access or refresh.
   */
  async bumpNonce(id: string, kind: 'access' | 'refresh'): Promise<void> {
    const set =
      kind === 'access'
        ? { accessTokenNonce: sql`${users.accessTokenNonce} + 1` }
        : { refreshTokenNonce: sql`${users.refreshTokenNonce} + 1` };
    await this.db.update(users).set(set).where(eq(users.id, id));
  }
}
