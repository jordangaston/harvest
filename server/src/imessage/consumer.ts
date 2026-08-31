import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectSender, type Sender } from './sender.js';
import { selectChef, ObjectiveStore, type Chef } from './chef.js';
import { selectThreadLock, type ThreadLock } from './lock.js';
import type { Doorbell } from './doorbell.js';

/**
 * Drains a thread's pending inbound and answers it. The consumer owns its collaborators — the
 * queue caller wakes it with a bare `Doorbell` and never sees the chef, sender, lock, or how the
 * thread is stored (it could be a file or memory; this logic doesn't know). `create` wires the
 * env-selected sender/chef/lock; tests construct it directly with doubles.
 */
export class Consumer {
  private readonly threads: ThreadRepository;
  private readonly objectives: ObjectiveStore;

  constructor(
    private readonly db: Database,
    private readonly sender: Sender,
    private readonly chef: Chef,
    private readonly lock: ThreadLock,
  ) {
    this.threads = ThreadRepository.create(db);
    this.objectives = ObjectiveStore.create(db);
  }

  /** Wires the consumer against the caller's db and the env-selected sender/chef/lock. */
  static async create(db: Database): Promise<Consumer> {
    return new Consumer(db, await selectSender(), selectChef(db), selectThreadLock());
  }

  /**
   * Processes one doorbell under the thread's lock (Idempotency & concurrency #3): only one
   * processor works a thread at a time. The doorbell is keyed by message_guid, so a lock loser
   * can safely do nothing — the holder re-drains in the loop below, and a message is always
   * committed to the DB before its doorbell fires. Each iteration is one turn: mark the pending
   * messages read, then — with the typing indicator up — ask the chef for a reply; nothing pending
   * ⇒ stop. The chef loads its own context and returns what to commit; the consumer commits its
   * `chatEvents` (outbound rows), `slotUpdates`, and cursor in ONE transaction, then sends the
   * unsent rows. The `sent_at` gate makes a redelivered doorbell a no-op; the loop drains messages
   * that arrived mid-turn.
   *
   * ponytail: the lock is `redlock` with no fencing token — a pause past the TTL can let two
   * turns write concurrently. Rare, accepted for now (spec D5); fix is a store-enforced fence.
   */
  async handle({ threadId }: Doorbell): Promise<void> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return;

    await this.lock.withThreadLock(threadId, async () => {
      let cursor = thread.lastProcessedId;
      for (;;) {
        const pending = await this.threads.loadPendingInbound(threadId, cursor);
        if (pending.length === 0) return; // drained — nothing left

        // Acknowledge receipt: mark the messages we're about to answer as read.
        await this.sender.markRead(thread.chatGuid, pending.map((m) => m.messageGuid));

        // Keep the typing indicator up while the chef composes, we commit, and the reply sends.
        const cursorTo = await this.sender.responding(thread.chatGuid, async () => {
          const reply = await this.chef.respond(threadId);
          if (!reply) return null; // nothing to say this turn — no commit, no send

          await this.db.transaction(async (tx) => {
            for (const event of reply.chatEvents) {
              if (event.kind !== 'text') continue; // the sender only sends text this increment
              await this.threads.insertOutbound({ threadId, body: event.text, messageGuid: randomUUID() }, tx);
            }
            await this.objectives.applySlotUpdates(reply.slotUpdates, tx);
            // Completion is a computable predicate — when every required slot is terminal the
            // objective completes and pops (the next suspended one, if any, activates).
            if (reply.objectiveId && (await this.objectives.isComplete(reply.objectiveId, tx)))
              await this.objectives.completeAndPop(reply.objectiveId, tx);
            await this.threads.advanceCursor(threadId, reply.cursorTo, tx);
          });

          const unsent = await this.threads.loadUnsentOutbound(threadId);
          if (unsent.length > 0) {
            // One ordered batch, not a rapid-fire loop — so the bubbles arrive in order.
            await this.sender.send(thread.chatGuid, unsent.map((r) => r.body ?? ''));
            const now = new Date();
            for (const row of unsent) await this.threads.markSent(row.id, now);
          }
          return reply.cursorTo;
        });
        if (cursorTo === null) return; // chef had nothing to answer — stop draining
        cursor = cursorTo; // re-check for messages that landed mid-turn before releasing the lock
      }
    });
  }
}
