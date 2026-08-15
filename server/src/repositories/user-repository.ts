import { eq, sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { users, recipes, cookbooks, importJobs, type NewUser } from '../db/schema/index.js';
import { UserSchema, type User } from '../models/user.js';

/** A drizzle transaction client — the type passed to each write in `deleteAccount`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export class UserRepository {
  constructor(private readonly db: Database) {}

  /** Wire dependencies from the shared singletons. */
  static create() {
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
  async insert(values: NewUser): Promise<User> {
    const [row] = await this.db.insert(users).values(values).returning();
    return UserSchema.parse(row);
  }

  /**
   * Permanently deletes a user and every row they own, in one transaction.
   *
   * Order respects the foreign keys: `import_jobs` and the meal-plan / grocery
   * rows (which reference recipes) go before `recipes`; `recipes` then cascades
   * its ingredients, steps, and join rows; `cookbooks` and the user row follow.
   * `meal_plan_entries` and `grocery_items` live on sibling branches, so their
   * deletes are guarded by `to_regclass` — a no-op until those tables exist, and
   * correct once they do.
   *
   * @param userId - The user to delete (the authenticated caller).
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(importJobs).where(eq(importJobs.userId, userId));
      // Sibling-branch tables (Meal Planning, Grocery List). Guarded so this is
      // a no-op until they exist, and correct once they do. Deleted before
      // `recipes` because they carry `recipe_id` FKs. Fully static SQL — no
      // dynamic identifier on a destructive path.
      if (await tableExists(tx, 'meal_plan_entries')) {
        await tx.execute(sql`delete from meal_plan_entries where user_id = ${userId}`);
      }
      if (await tableExists(tx, 'grocery_items')) {
        await tx.execute(sql`delete from grocery_items where user_id = ${userId}`);
      }
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

/**
 * Whether a table exists in the public schema. Lets `deleteAccount` clean up
 * sibling-branch tables that may not have merged yet. `name` is a fixed source
 * literal, bound as a value to `to_regclass`.
 */
async function tableExists(tx: Tx, name: 'meal_plan_entries' | 'grocery_items'): Promise<boolean> {
  const { rows } = await tx.execute<{ reg: string | null }>(sql`select to_regclass(${'public.' + name}) as reg`);
  return rows[0]?.reg != null;
}
