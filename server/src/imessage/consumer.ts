import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectSender, type Sender } from './sender.js';
import { selectChef, ObjectiveStore, type Chef } from './chef.js';
import { selectThreadLock, type ThreadLock } from './lock.js';
import type { Doorbell } from './doorbell.js';

/** Hand-wired dependencies for the doorbell handler (no DI container). */
export interface ConsumerDeps {
  db: Database;
  sender: Sender;
  chef: Chef;
  lock: ThreadLock;
}

/** Wires the handler against the singletons and the env-selected sender/chef/lock. */
export async function defaultDeps(db: Database): Promise<ConsumerDeps> {
  return { db, sender: await selectSender(), chef: selectChef(db), lock: selectThreadLock() };
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
export async function handleDoorbell({ threadId }: Doorbell, deps: ConsumerDeps): Promise<void> {
  const threads = ThreadRepository.create(deps.db);
  const objectives = ObjectiveStore.create(deps.db);
  const thread = await threads.findById(threadId);
  if (!thread) return;

  await deps.lock.withThreadLock(threadId, async () => {
    let cursor = thread.lastProcessedId;
    for (;;) {
      const pending = await threads.loadPendingInbound(threadId, cursor);
      if (pending.length === 0) return; // drained — nothing left

      // Acknowledge receipt: mark the messages we're about to answer as read.
      await deps.sender.markRead(thread.chatGuid, pending.map((m) => m.messageGuid));

      // Keep the typing indicator up while the chef composes, we commit, and the reply sends.
      const cursorTo = await deps.sender.responding(thread.chatGuid, async () => {
        const reply = await deps.chef.respond(threadId);
        if (!reply) return null; // nothing to say this turn — no commit, no send

        await deps.db.transaction(async (tx) => {
          for (const event of reply.chatEvents) {
            if (event.kind !== 'text') continue; // the sender only sends text this increment
            await threads.insertOutbound({ threadId, body: event.text, messageGuid: randomUUID() }, tx);
          }
          await objectives.applySlotUpdates(reply.slotUpdates, tx);
          await threads.advanceCursor(threadId, reply.cursorTo, tx);
        });

        for (const row of await threads.loadUnsentOutbound(threadId)) {
          await deps.sender.send(thread.chatGuid, row.body ?? '');
          await threads.markSent(row.id, new Date());
        }
        return reply.cursorTo;
      });
      if (cursorTo === null) return; // chef had nothing to answer — stop draining
      cursor = cursorTo; // re-check for messages that landed mid-turn before releasing the lock
    }
  });
}
