import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, type NewUser } from '../schema.js';
import { UserSchema, type User } from '../models/user.js';

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
