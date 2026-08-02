import { eq, sql } from 'drizzle-orm';
import { users, type User, type NewUser } from '../db/schema/users.js';
import type { Database } from '../db/index.js';

/**
 * The subset of a Drizzle client the repository calls. Both the base
 * `Database` and a transaction handle passed to `db.transaction(tx => ...)`
 * satisfy it, so every method takes an optional `tx?` and runs inside a
 * caller's transaction when given one (used by the find-or-create flow).
 */
export type DbExecutor = Pick<Database, 'insert' | 'select' | 'update'>;

/** Fields required to provision a user; the DB defaults id/nonces/created_at. */
export interface CreateUserInput {
  phone: string;
  jwtPrivateKey: string;
  jwtPublicKey: string;
  onboarding?: unknown;
}

/**
 * Data access for the `users` table. Phone is the unique account key (BR-01):
 * `findByPhone` powers idempotent find-or-create, and the nonce bumpers revoke
 * outstanding tokens.
 */
export class UserRepository {
  constructor(private readonly db: Database) {}

  /** Inserts a user and returns the created row (incl. generated id/nonces). */
  async create(input: CreateUserInput, tx?: DbExecutor): Promise<User> {
    const values: NewUser = {
      phone: input.phone,
      jwtPrivateKey: input.jwtPrivateKey,
      jwtPublicKey: input.jwtPublicKey,
      onboarding: input.onboarding ?? null,
    };
    const [row] = await this.exec(tx).insert(users).values(values).returning();
    return row;
  }

  /** Finds a user by canonical E.164 phone, or undefined. */
  async findByPhone(phone: string, tx?: DbExecutor): Promise<User | undefined> {
    const [row] = await this.exec(tx).select().from(users).where(eq(users.phone, phone));
    return row;
  }

  /** Finds a user by uuid id, or undefined. */
  async findById(id: string, tx?: DbExecutor): Promise<User | undefined> {
    const [row] = await this.exec(tx).select().from(users).where(eq(users.id, id));
    return row;
  }

  /** Bumps the access-token nonce, revoking outstanding access tokens. */
  async bumpAccessNonce(id: string, tx?: DbExecutor): Promise<User | undefined> {
    const [row] = await this.exec(tx)
      .update(users)
      .set({ accessTokenNonce: sql`${users.accessTokenNonce} + 1` })
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  /** Bumps the refresh-token nonce, revoking outstanding refresh tokens. */
  async bumpRefreshNonce(id: string, tx?: DbExecutor): Promise<User | undefined> {
    const [row] = await this.exec(tx)
      .update(users)
      .set({ refreshTokenNonce: sql`${users.refreshTokenNonce} + 1` })
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.db;
  }
}
