import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, threads, threadMessages } from '../schema.js';
import { ThreadSchema, type Thread } from '../models/thread.js';
import { ThreadMessageSchema, type ThreadMessage } from '../models/thread-message.js';
import { pendingPast } from '../imessage/consumer-logic.js';

/** A write/read executor: the db singleton or an interactive transaction client. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** The inbound message fields the webhook records. A tapback carries `reactionEmoji`
 *  + `targetGuid` (the message reacted to); every other arm omits them. */
export interface InboundMessageInput {
  threadId: string;
  senderUserId: string;
  type: 'text' | 'reaction' | 'reply' | 'attachment';
  body: string | null;
  targetGuid?: string | null;
  reactionEmoji?: string | null;
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

  /** The iMessage handle of a user (the thread initiator), or '' if none is on file. */
  async handleForUser(userId: string, tx: Executor = this.db): Promise<string> {
    const [row] = await tx.select({ handle: users.imessageHandle }).from(users).where(eq(users.id, userId));
    return row?.handle ?? '';
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
    const { targetGuid, reactionEmoji, ...rest } = input;
    // Inbound's message_guid IS its Spectrum platform id, so external_id mirrors it —
    // giving every row the uniform platform id that reply/reaction targets resolve against.
    await tx
      .insert(threadMessages)
      .values({ ...rest, direction: 'inbound', targetMessageGuid: targetGuid, reactionEmoji, externalId: input.messageGuid })
      .onConflictDoNothing({ target: threadMessages.messageGuid });
  }

  /**
   * Loads the thread's inbound *answerable* messages (`text` and threaded `reply`) newer
   * than the cursor, in order — a reply carries its own text, so it drives a turn like a
   * plain text does (a bare reaction stays context-only). The cursor cut is the pure
   * `pendingPast` (unit-tested without a DB).
   * @param cursor - The current `last_processed_id`; null loads all answerable inbound.
   */
  async loadPendingInbound(threadId: string, cursor: string | null): Promise<ThreadMessage[]> {
    const rows = await this.db
      .select()
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, threadId),
          eq(threadMessages.direction, 'inbound'),
          inArray(threadMessages.type, ['text', 'reply']),
        ),
      )
      .orderBy(asc(threadMessages.createdAt), asc(threadMessages.id));
    return pendingPast(rows.map((row) => ThreadMessageSchema.parse(row)), cursor);
  }

  /** Finds a message in a thread by its Spectrum platform id — the `external_id` a reply/reaction
   *  target points at (uniform across inbound and sent-outbound rows), or null. */
  async findByPlatformId(threadId: string, platformId: string): Promise<ThreadMessage | null> {
    const [row] = await this.db
      .select()
      .from(threadMessages)
      .where(and(eq(threadMessages.threadId, threadId), eq(threadMessages.externalId, platformId)));
    return row ? ThreadMessageSchema.parse(row) : null;
  }

  /** True when an inbound text message exists past the cursor (the interruption-barrier check). */
  async hasInboundPast(threadId: string, cursor: string): Promise<boolean> {
    return (await this.loadPendingInbound(threadId, cursor)).length > 0;
  }

  /** Inserts one outbound text row with `sent_at` NULL (the unsent send gate). */
  async insertOutbound(
    input: { threadId: string; body: string; messageGuid: string },
    tx: Executor = this.db,
  ): Promise<void> {
    await tx.insert(threadMessages).values({ ...input, direction: 'outbound', type: 'text' });
  }

  /** Advances the cursor to the newest processed inbound id and bumps updated_at. */
  async advanceCursor(threadId: string, lastProcessedId: string, tx: Executor = this.db): Promise<void> {
    await tx
      .update(threads)
      .set({ lastProcessedId, updatedAt: new Date() })
      .where(eq(threads.id, threadId));
  }

  /** Links a thread to its household by setting `threads.household_id` (which supersedes
   *  `owner_user_id` as the thread's owner once a household exists). */
  async linkHousehold(threadId: string, householdId: string, tx: Executor = this.db): Promise<void> {
    await tx.update(threads).set({ householdId, updatedAt: new Date() }).where(eq(threads.id, threadId));
  }

  /** Loads the thread's unsent outbound rows (the send gate: `sent_at IS NULL`). */
  async loadUnsentOutbound(threadId: string): Promise<ThreadMessage[]> {
    const rows = await this.db
      .select()
      .from(threadMessages)
      .where(
        and(
          eq(threadMessages.threadId, threadId),
          eq(threadMessages.direction, 'outbound'),
          isNull(threadMessages.sentAt),
        ),
      )
      // rowid = true insertion order; created_at is second-granularity so a turn's bubbles tie
      // there, and ordering by the uuid id would scramble them. Batch order must be send order.
      .orderBy(sql`rowid`);
    return rows.map((row) => ThreadMessageSchema.parse(row));
  }

  /** Marks an outbound row sent — the idempotency gate, written after the send resolves. */
  async markSent(messageId: string, sentAt: Date): Promise<void> {
    await this.db.update(threadMessages).set({ sentAt }).where(eq(threadMessages.id, messageId));
  }

  /** Records an outbound row's Spectrum platform id, returned by the send (WI-C). */
  async setExternalId(messageId: string, externalId: string): Promise<void> {
    await this.db.update(threadMessages).set({ externalId }).where(eq(threadMessages.id, messageId));
  }

  /** Loads a thread by id (the doorbell payload), parsed into the domain model, or null. */
  async findById(threadId: string): Promise<Thread | null> {
    const [row] = await this.db.select().from(threads).where(eq(threads.id, threadId));
    return row ? ThreadSchema.parse(row) : null;
  }
}
