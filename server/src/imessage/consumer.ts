import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectSender, type Sender } from './sender.js';
import { selectChef, ObjectiveRepository, type Chef } from './chef.js';
import { selectThreadLock, type ThreadLock } from './lock.js';
import type { Doorbell } from './doorbell.js';
import type { ThreadMessage } from '../models/thread-message.js';
import { TAPBACK_GLYPHS } from '../chef/types.js';

/**
 * Drains a thread's pending inbound and answers it. The consumer owns its collaborators — the
 * queue caller wakes it with a bare `Doorbell` and never sees the chef, sender, lock, or how the
 * thread is stored (it could be a file or memory; this logic doesn't know). `create` wires the
 * env-selected sender/chef/lock; tests construct it directly with doubles.
 */
export class Consumer {
  private readonly threads: ThreadRepository;
  private readonly objectives: ObjectiveRepository;

  constructor(
    private readonly db: Database,
    private readonly sender: Sender,
    private readonly chef: Chef,
    private readonly lock: ThreadLock,
  ) {
    this.threads = ThreadRepository.create(db);
    this.objectives = ObjectiveRepository.create(db);
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
      // One-time screen-effect gates (WI-4B): confetti on the first-ever Chef turn, fireworks the
      // turn onboarding completes. Seeded from the thread's flags (null ⇒ still pending) so a
      // redelivered doorbell — a fresh handle() that reloads the thread — can't re-fire; flipped
      // once fired so the multi-turn drain loop fires each at most once.
      let greetPending = thread.greetedAt === null;
      let celebratePending = thread.celebratedAt === null;
      for (;;) {
        const pending = await this.threads.loadPendingInbound(threadId, cursor);
        if (pending.length === 0) return; // drained — nothing left

        // Acknowledge receipt: mark the messages we're about to answer as read.
        await this.sender.markRead(thread.chatGuid, pending.map((m) => m.messageGuid));

        // Keep the typing indicator up while the chef composes, we commit, and the reply sends.
        const cursorTo = await this.sender.responding(thread.chatGuid, async () => {
          const reply = await this.chef.respond(threadId);
          if (!reply) return null; // nothing to say this turn — no commit, no send

          // Whether this turn fires an effect, decided in-txn (below) against the fresh flags +
          // post-update completion, then honoured by the send half after the commit.
          const greetNow = greetPending;
          let celebrateNow = false;

          await this.db.transaction(async (tx) => {
            for (const event of reply.chatEvents) {
              // A tapback persists as a `type='reaction'` row (glyph + the target's external_id); a
              // richlink as a `[richlink:<url>]` body marker (no enum value) the send half unwraps.
              if (event.kind === 'tapback') {
                await this.threads.insertOutbound(
                  { threadId, body: null, messageGuid: randomUUID(), type: 'reaction', reactionEmoji: TAPBACK_GLYPHS[event.emoji], targetGuid: event.target },
                  tx,
                );
                continue;
              }
              const body = event.kind === 'text' ? event.text : `[richlink:${event.url}]`;
              await this.threads.insertOutbound({ threadId, body, messageGuid: randomUUID() }, tx);
            }
            await this.objectives.applySlotUpdates(reply.slotUpdates, tx);
            // Completion is a computable predicate — when every required slot is terminal the
            // objective completes and pops (the next suspended one, if any, activates).
            const completedNow =
              !!reply.objectiveId && (await this.objectives.isComplete(reply.objectiveId, tx));
            if (completedNow) await this.objectives.completeAndPop(reply.objectiveId, tx);
            await this.threads.advanceCursor(threadId, reply.cursorTo, tx);
            // Stamp the effect gates in the same commit as the outbound rows, so the send fires
            // exactly once even if the process dies before the send (redelivery reloads a set flag).
            const now = new Date();
            if (greetNow) await this.threads.markGreeted(threadId, now, tx);
            celebrateNow = completedNow && celebratePending;
            if (celebrateNow) await this.threads.markCelebrated(threadId, now, tx);
          });

          greetPending = greetPending && !greetNow; // fired once; don't confetti a later turn
          celebratePending = celebratePending && !celebrateNow; // fired once; don't re-fireworks a later completion
          const unsent = await this.threads.loadUnsentOutbound(threadId);
          await this.dispatch(thread.chatGuid, unsent, greetNow);
          // Fireworks the moment onboarding completes — a short extra bubble, not a normal reply.
          if (celebrateNow) await this.sender.sendEffect(thread.chatGuid, 'Your first menu is on its way! 🎆', 'fireworks');
          return reply.cursorTo;
        });
        if (cursorTo === null) return; // chef had nothing to answer — stop draining
        cursor = cursorTo; // re-check for messages that landed mid-turn before releasing the lock
      }
    });
  }

  /**
   * Sends the unsent outbound rows in row order, preserving text batching, richlink, and reaction
   * ordering. Contiguous text rows accumulate into one ordered `send` batch (so iMessage can't
   * reorder the bubbles); a richlink row (a `[richlink:<url>]` body marker) or a `type='reaction'`
   * row first flushes any pending text batch, then dispatches via `sendLink` / `sendReaction` —
   * keeping the overall sequence intact. Every row gets marked sent (the `sent_at` idempotency gate);
   * text/richlink rows also capture the send's returned `external_id` (a reaction returns none).
   */
  private async dispatch(chatGuid: string, unsent: ThreadMessage[], greet = false): Promise<void> {
    let batch: ThreadMessage[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const ids = await this.sender.send(chatGuid, batch.map((r) => r.body ?? ''));
      await this.markRowsSent(batch, ids);
      batch = [];
    };

    for (const row of unsent) {
      if (row.type === 'reaction') {
        await flush(); // text before this reaction must land first
        await this.sender.sendReaction(chatGuid, row.targetMessageGuid!, row.reactionEmoji!);
        await this.markRowsSent([row], []); // no external_id — a reaction isn't a targetable message
        continue;
      }
      const link = /^\[richlink:(.+)\]$/.exec(row.body ?? '');
      if (!link) {
        // Confetti greeting (WI-4B): the first text bubble of the greeting turn ships alone via
        // sendEffect(confetti); the rest batch normally. Consumed once, so only that bubble carries it.
        if (greet) {
          greet = false;
          const ids = await this.sender.sendEffect(chatGuid, row.body ?? '', 'confetti');
          await this.markRowsSent([row], ids);
          continue;
        }
        batch.push(row);
        continue;
      }
      await flush(); // text before this link must land first
      const ids = await this.sender.sendLink(chatGuid, link[1]!);
      await this.markRowsSent([row], ids);
    }
    await flush(); // any trailing text
  }

  /** Marks each row sent and maps the send's returned platform ids back to rows by index. A degraded
   *  return (fewer ids than rows) leaves the unmatched rows' external_id null rather than mis-assigning. */
  private async markRowsSent(rows: ThreadMessage[], ids: string[]): Promise<void> {
    const now = new Date();
    for (const [i, row] of rows.entries()) {
      await this.threads.markSent(row.id, now);
      if (ids[i]) await this.threads.setExternalId(row.id, ids[i]!);
    }
  }
}
