import { eq, sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { users } from '../db/schema/index.js';
import { UserSchema, type User } from '../models/user.js';

export class UserRepository {
  constructor(private readonly db: Database) {}

  static create() {
    return new UserRepository(db);
  }

  async findByPhone(phone: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.phone, phone));
    return row ? UserSchema.parse(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? UserSchema.parse(row) : null;
  }

  async insert(values: { phone: string; jwtPrivateKey: string; jwtPublicKey: string; onboarding?: unknown }): Promise<User> {
    const [row] = await this.db.insert(users).values(values).returning();
    return UserSchema.parse(row);
  }

  /** Bumps a nonce, revoking that token family. */
  async bumpNonce(id: string, kind: 'access' | 'refresh'): Promise<void> {
    const set =
      kind === 'access'
        ? { accessTokenNonce: sql`${users.accessTokenNonce} + 1` }
        : { refreshTokenNonce: sql`${users.refreshTokenNonce} + 1` };
    await this.db.update(users).set(set).where(eq(users.id, id));
  }
}
