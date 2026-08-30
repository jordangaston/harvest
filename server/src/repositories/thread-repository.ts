import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, threads, threadMessages } from '../schema.js';
import { ThreadSchema, type Thread } from '../models/thread.js';

/** A write/read executor: the db singleton or an interactive transaction client. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** The inbound message fields the webhook records (increment 1: text only). */
export interface InboundMessageInput {
  threadId: string;
  senderUserId: string;
  type: 'text' | 'reaction' | 'reply' | 'attachment';
  body: string | null;
  messageGuid: string;
}

/**
 * Data access for `threads`, `thread_messages`, and iMessage-handle user upserts.
 * The webhook route composes these in one transaction (upsert user → upsert thread
 * → insert inbound); each method is small so the transaction reads as its steps.
 */
export class ThreadRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new ThreadRepository(db);
  }

  /**
   * Resolves the user for an iMessage handle, creating one on first contact.
   * @returns The user id (existing or newly inserted).
   */
  async upsertUserByHandle(handle: string, tx: Executor = this.db): Promise<string> {
    // ponytail: empty jwt keys — the NOT NULL columns exist for bearer-token auth,
    // which an iMessage-only user never uses in increment 1. Mint a real keypair here
    // when these users need to sign in (increment 2 identity linking).
    await tx
      .insert(users)
      .values({ imessageHandle: handle, jwtPrivateKey: '', jwtPublicKey: '' })
      .onConflictDoNothing({ target: users.imessageHandle });
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.imessageHandle, handle));
    return row!.id;
  }

  /**
   * Resolves the thread for a chat_guid, creating one owned by `ownerUserId` on first
   * contact.
   * @returns The thread, parsed into the domain model.
   */
  async upsertThreadByChatGuid(
    input: { chatGuid: string; ownerUserId: string },
    tx: Executor = this.db,
  ): Promise<Thread> {
    await tx.insert(threads).values(input).onConflictDoNothing({ target: threads.chatGuid });
    const [row] = await tx.select().from(threads).where(eq(threads.chatGuid, input.chatGuid));
    return ThreadSchema.parse(row);
  }

  /**
   * Inserts one inbound message; a redelivery with the same `message_guid` is a no-op
   * (the unique index makes inbound dedup a DB constraint).
   */
  async insertInboundMessage(input: InboundMessageInput, tx: Executor = this.db): Promise<void> {
    await tx
      .insert(threadMessages)
      .values({ ...input, direction: 'inbound' })
      .onConflictDoNothing({ target: threadMessages.messageGuid });
  }
}
