import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectSender, type Sender } from './sender.js';
import { selectChef, type Chef } from './chef.js';
import { newestProcessedId } from './consumer-logic.js';
import type { Doorbell } from './doorbell.js';

/** Hand-wired dependencies for the doorbell handler (no DI container). */
export interface ConsumerDeps {
  db: Database;
  sender: Sender;
  chef: Chef;
}

/** Wires the handler against the singletons and the env-selected sender/chef. */
export async function defaultDeps(db: Database): Promise<ConsumerDeps> {
  return { db, sender: await selectSender(), chef: selectChef() };
}

/**
 * Processes one doorbell: load the thread's pending inbound text past the cursor; if
 * none, ack and stop (AC-6). Otherwise invoke the chef, then in ONE transaction write
 * the reply as an outbound row (sent_at NULL) and advance the cursor to the newest
 * processed inbound id. After commit, send each unsent outbound row and mark it sent —
 * the sent_at gate makes a redelivered doorbell a no-op (AC-7).
 *
 * ponytail: coalescing + the visibility lease give single-flight only while one
 * consumer holds the lease. Two concurrent same-thread turns (past the lease) can both
 * read the same pending and double-reply. Hardening = a per-thread DB lease + commit-time
 * cursor CAS, deferred to increment 2 (spec D5 / AC-7 ceiling).
 */
export async function handleDoorbell({ threadId }: Doorbell, deps: ConsumerDeps): Promise<void> {
  const threads = ThreadRepository.create(deps.db);
  const thread = await threads.findById(threadId);
  if (!thread) return;

  const pending = await threads.loadPendingInbound(threadId, thread.lastProcessedId);
  if (pending.length === 0) return;

  const reply = (await deps.chef.respond({ messages: pending.map((m) => m.body ?? '') })).trim();
  const cursor = newestProcessedId(pending)!;
  await deps.db.transaction(async (tx) => {
    // An empty reply advances the cursor without sending — never text an empty iMessage.
    if (reply) await threads.insertOutbound({ threadId, body: reply, messageGuid: randomUUID() }, tx);
    await threads.advanceCursor(threadId, cursor, tx);
  });

  for (const row of await threads.loadUnsentOutbound(threadId)) {
    await deps.sender.send(thread.chatGuid, row.body ?? '');
    await threads.markSent(row.id, new Date());
  }
}
