import type { Database } from '../db.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { HouseholdRepository } from '../repositories/household-repository.js';
import { selectSender, type Sender } from './sender.js';
import { selectChef, ObjectiveRepository, type Chef, type ConfirmTask, type OutboundSink, type TaskUpdate } from './chef.js';
import { selectThreadLock, type ThreadLock } from './lock.js';
import type { Doorbell } from './doorbell.js';
import type { ChatEvent } from '../chef/types.js';
import { TAPBACK_GLYPHS } from '../chef/types.js';

/**
 * The Consumer's per-turn live outbound channel (increment 2). Each `send` journals an outbound row
 * tagged `trigger_id` + a deterministic `${triggerId}#${ordinal}` guid (`onConflictDoNothing`), then
 * flushes it live through the `Sender`. On a redelivered, re-run turn the same guid already exists
 * and is already sent → the send is skipped, so the household sees each bubble exactly once.
 */
class LiveOutboundSink implements OutboundSink {
  private ordinal = 0;

  constructor(
    private readonly threads: ThreadRepository,
    private readonly sender: Sender,
    private readonly threadId: string,
    private readonly chatGuid: string,
    private readonly triggerId: string,
  ) {}

  async send(event: ChatEvent): Promise<void> {
    const messageGuid = `${this.triggerId}#${this.ordinal++}`;
    const row =
      event.kind === 'tapback'
        ? { type: 'reaction' as const, body: null, reactionEmoji: TAPBACK_GLYPHS[event.emoji], targetGuid: event.target }
        : { body: event.kind === 'text' ? event.text : `[richlink:${event.url}]` };
    const { id, alreadySent } = await this.threads.insertOutboundIdempotent({
      threadId: this.threadId,
      messageGuid,
      triggerId: this.triggerId,
      ...row,
    });
    if (alreadySent) return; // a redelivery replay — this bubble already went out; skip the live send
    const ids = await this.deliver(event);
    await this.threads.markSent(id, new Date());
    if (ids[0]) await this.threads.setExternalId(id, ids[0]);
  }

  /** Sends one event live and returns its platform id(s): text→`send`, tapback→`sendReaction`,
   *  richlink→`sendLink`. */
  private async deliver(event: ChatEvent): Promise<string[]> {
    switch (event.kind) {
      case 'text':
        return this.sender.send(this.chatGuid, [event.text]);
      case 'richlink':
        return this.sender.sendLink(this.chatGuid, event.url);
      case 'tapback':
        await this.sender.sendReaction(this.chatGuid, event.target, TAPBACK_GLYPHS[event.emoji]);
        return []; // a reaction returns no targetable platform id
    }
  }
}

/**
 * Drains a thread's pending inbound and answers it. The consumer owns its collaborators — the
 * queue caller wakes it with a bare `Doorbell` and never sees the chef, sender, lock, or how the
 * thread is stored (it could be a file or memory; this logic doesn't know). `create` wires the
 * env-selected sender/chef/lock; tests construct it directly with doubles.
 */
export class Consumer {
  private readonly threads: ThreadRepository;
  private readonly objectives: ObjectiveRepository;
  private readonly households: HouseholdRepository;

  constructor(
    private readonly db: Database,
    private readonly sender: Sender,
    private readonly chef: Chef,
    private readonly lock: ThreadLock,
  ) {
    this.threads = ThreadRepository.create(db);
    this.objectives = ObjectiveRepository.create(db);
    this.households = HouseholdRepository.create(db);
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
   * messages read, then — with the typing indicator up — ask the chef for a reply. The chef sends
   * its bubbles LIVE through the per-turn `sink` (increment 2), each row tagged `trigger_id` +
   * deduped by a deterministic guid; the consumer then commits fact-less-task confirmations,
   * completion, and the cursor LAST in ONE transaction. On redelivery the sink re-runs against the
   * same trigger, so already-sent bubbles are skipped and the cursor advance re-commits idempotently.
   * The loop drains messages that arrived mid-turn.
   *
   * ponytail: the lock is `redlock` with no fencing token — a pause past the TTL can let two
   * turns write concurrently. Rare, accepted for now (spec D5); fix is a store-enforced fence.
   */
  async handle({ threadId }: Doorbell): Promise<void> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return;

    await this.lock.withThreadLock(threadId, async () => {
      let cursor = thread.lastProcessedId;
      // Confetti/fireworks/contact-card effects are removed for now (WI-4B/4C deferred) — they fired on
      // a premature completion. The one-time RENAME gate stays: rename the chat to "Meal Planning" the
      // turn the household's roster is first set (group chats only — a DM no-ops). Seeded null ⇒ pending, flipped
      // once fired so the drain loop can't double-fire, and stamped in-txn so redelivery can't re-fire.
      let renamePending = thread.renamedAt === null;
      for (;;) {
        const pending = await this.threads.loadPendingInbound(threadId, cursor);
        if (pending.length === 0) return; // drained — nothing left
        // The trigger id tags every outbound row this turn and is where the cursor lands — the newest
        // pending inbound. On redelivery the same trigger re-derives the same deterministic send guids.
        const triggerId = pending[pending.length - 1]!.id;

        // Acknowledge receipt: mark the messages we're about to answer as read.
        await this.sender.markRead(thread.chatGuid, pending.map((m) => m.messageGuid));

        const sink = new LiveOutboundSink(this.threads, this.sender, threadId, thread.chatGuid, triggerId);

        // Keep the typing indicator up while the chef composes + sends live, then we commit.
        const cursorTo = await this.sender.responding(thread.chatGuid, async () => {
          const reply = await this.chef.respond(threadId, sink);
          if (!reply) return null; // nothing to say this turn — no commit, no send
          // Send proves delivery: a fact-less confirm (emit filled / ack asked) and completion may
          // only fire when the turn actually delivered a bubble. An empty turn (reasoning-agent
          // MAX_ATTEMPTS fallback, or a model that didn't deliver the close) must NOT confirm the
          // emit or pop the objective — the close was never sent.
          const delivered = reply.delivered;

          // The household exists from the first inbound now, so household-existence no longer marks
          // the moment a chat becomes a real household — the ROSTER does. Rename once members are
          // present (the turn `add_members` ran), re-reading after respond so the same-turn roster shows.
          const hasRoster =
            thread.householdId !== null && (await this.households.loadMembers(thread.householdId)).length > 0;
          const renameNow = renamePending && hasRoster;

          await this.db.transaction(async (tx) => {
            // Confirm the fact-less tasks now the turn's bubbles went out: an emit's just delivered
            // (→ filled); the explainer-ack elicit is asked when first delivered and filled by the
            // next inbound. ponytail: onboarding's gate is linear (ack first+solo, close last), so
            // "an eligible fact-less task was addressed this turn" is a safe status-driven heuristic.
            if (delivered) await this.confirmTasks(reply.confirmTasks, tx);
            // Completion is a computable predicate — when every required task is terminal the
            // objective completes and pops (the next suspended one, if any, activates). Only when a
            // bubble went out this turn: an empty turn can't have delivered the close.
            const completedNow =
              delivered && !!reply.objectiveId && (await this.objectives.isComplete(reply.objectiveId, tx));
            if (completedNow) await this.objectives.completeAndPop(reply.objectiveId, tx);
            // Cursor LAST — after confirm/complete — so a crash mid-turn leaves it unmoved and the
            // doorbell redelivers to re-run the turn (already-sent bubbles skip in the sink).
            await this.threads.advanceCursor(threadId, reply.cursorTo, tx);
            // Rename once the household exists; stamp even for a DM (which no-ops on send) so it never
            // retries. (Confetti/fireworks/contact-card effects removed — WI-4B/4C deferred.)
            if (renameNow) await this.threads.markRenamed(threadId, new Date(), tx);
          });

          renamePending = renamePending && !renameNow; // fired once; don't re-rename a later turn
          // Rename the chat to "Meal Planning" once the roster is set (group only; DM no-ops).
          if (renameNow) await this.sender.renameChat(thread.chatGuid, 'Meal Planning');
          return reply.cursorTo;
        });
        if (cursorTo === null) return; // chef had nothing to answer — stop draining
        cursor = cursorTo; // re-check for messages that landed mid-turn before releasing the lock
      }
    });
  }

  /**
   * Confirms the turn's fact-less tasks now that its bubbles are committing (send proves delivery).
   * An `emit` is marked `filled` — its content just went out. The explainer-ack `elicit` is marked
   * `asked` the turn it is first delivered (status `unasked`), and `filled` on the next inbound (its
   * status is already `asked`) — the reply is the acknowledgment, unblocking the gated tasks.
   */
  private async confirmTasks(confirm: ConfirmTask[], tx: Parameters<typeof ObjectiveRepository.prototype.applyTaskUpdates>[1]): Promise<void> {
    const updates: TaskUpdate[] = confirm.map((t) => ({
      taskId: t.taskId,
      status: t.kind === 'emit' ? 'filled' : t.status === 'asked' ? 'filled' : 'asked',
    }));
    if (updates.length) await this.objectives.applyTaskUpdates(updates, tx);
  }
}
