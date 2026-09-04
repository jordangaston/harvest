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
 * tagged `trigger_id` + a deterministic `${guidPrefix}#${ordinal}` guid (`onConflictDoNothing`), then
 * flushes it live through the `Sender`. On a redelivered, re-run turn the same guid already exists
 * and is already sent → the send is skipped, so the household sees each bubble exactly once. The
 * `guidPrefix` is the trigger inbound id on a normal turn, or the objective id on a triggerless
 * kick-off (no inbound to key on) — so a redelivered kick-off dedupes the same (AC-9).
 */
class LiveOutboundSink implements OutboundSink {
  private ordinal = 0;

  constructor(
    private readonly threads: ThreadRepository,
    private readonly sender: Sender,
    private readonly threadId: string,
    private readonly chatGuid: string,
    private readonly guidPrefix: string,
    private readonly triggerId: string | null,
  ) {}

  async send(event: ChatEvent): Promise<void> {
    const messageGuid = `${this.guidPrefix}#${this.ordinal++}`;
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
      // Confetti/fireworks effects stay deferred (WI-4B) — they fired on a premature completion. Two
      // one-time gates remain, both seeded null ⇒ pending, flipped once fired so the drain loop can't
      // double-fire, and stamped in-txn so redelivery can't re-fire: RENAME the chat to "Meal Planning"
      // the turn the household's roster is first set (group only — a DM no-ops), and share Chef's
      // CONTACT CARD on the first message so the household can save her (DM + group).
      let renamePending = thread.renamedAt === null;
      let cardPending = thread.cardedAt === null;
      // Whether the previous turn popped its objective — drives the kick-off continuation (AC-4/5):
      // a popped turn runs one more iteration against the newly-active objective even with no pending
      // inbound; a turn that only parked stops the loop.
      let lastPopped = false;
      for (;;) {
        const pending = await this.threads.loadPendingInbound(threadId, cursor);
        // With no pending inbound, a kick-off runs only when the last turn popped (chain a fresh pop
        // into its opener) OR the active objective carries the durable kickoff-pending marker (resume a
        // kick-off stranded by a crash between an earlier pop and its opener — spec AC-7). Load the
        // active objective to read that marker; no pending, no pop, no marker ⇒ drained or parked, stop.
        // Termination is bounded by stack depth (a pop clears the marker's predecessor; the opener
        // clears the marker), so no spin.
        const kickOff = pending.length === 0;
        const active = kickOff ? await this.objectives.loadActive(threadId) : null;
        const kickoffPending = active?.objective.context?.kickoffPendingAt !== undefined;
        if (kickOff && !lastPopped && !kickoffPending) return;

        // A kick-off (no pending inbound) has no trigger id — key its sends on the now-active objective
        // id (AC-9). No active objective ⇒ the stack emptied; nothing to kick off.
        if (kickOff && !active) return;
        // Normal turn: the trigger id (newest pending) tags every outbound row and keys its guids;
        // kick-off: the objective id keys the guids, and the row carries no trigger id.
        const triggerId = kickOff ? null : pending[pending.length - 1]!.id;
        const guidPrefix = kickOff ? active!.objective.id : triggerId!;

        // Acknowledge receipt: mark the messages we're about to answer as read (none on a kick-off).
        if (!kickOff) await this.sender.markRead(thread.chatGuid, pending.map((m) => m.messageGuid));

        const sink = new LiveOutboundSink(this.threads, this.sender, threadId, thread.chatGuid, guidPrefix, triggerId);

        // Keep the typing indicator up while the chef composes + sends live, then we commit.
        const outcome = await this.sender.responding(thread.chatGuid, async () => {
          const reply = await this.chef.respond(threadId, sink);
          if (!reply) return null; // nothing to say this turn — no commit, no send
          // Send proves delivery: the fact-less ack confirm and the AC-8 safety net may only fire when
          // the turn actually delivered a bubble.
          const delivered = reply.delivered;

          // The household exists from the first inbound now, so household-existence no longer marks
          // the moment a chat becomes a real household — the ROSTER does. Rename once members are
          // present (the turn `household__add_members` ran), re-reading after respond so the same-turn roster shows.
          const hasRoster =
            thread.householdId !== null && (await this.households.loadMembers(thread.householdId)).length > 0;
          const renameNow = renamePending && hasRoster;
          const cardNow = !kickOff && cardPending; // the first turn we ANSWER shares Chef's card

          await this.db.transaction(async (tx) => {
            // Confirm the explainer-ack now the turn's bubbles went out: asked when first delivered,
            // filled by the next inbound. The emit is no longer confirmed here — it completes in-loop
            // via tasks__update (the pop lives in the tool). The AC-8 safety net below covers a
            // delivered-but-unmarked required emit so the terminal flow can't stall.
            if (delivered) await this.confirmAcks(reply.confirmTasks, tx);
            // AC-8 only when the turn did NOT already pop in-loop — a popped turn marked its emit via
            // tasks__update, so re-filling/re-popping here would double-activate a suspended sibling.
            if (delivered && !reply.popped) await this.completeDeliveredEmit(reply.confirmTasks, reply.objectiveId, tx);
            // A kick-off turn that delivered its opener clears the objective's kickoff-pending marker,
            // so a later bare doorbell no longer re-enters it (AC-7). Guid dedup already made the opener
            // fire exactly once; this just retires the re-entry arm now the opener is out.
            if (kickOff && delivered && active) await this.objectives.clearKickoffPending(active.objective.id, tx);
            // Cursor LAST — after confirm/complete — so a crash mid-turn leaves it unmoved and the
            // doorbell redelivers to re-run the turn (already-sent bubbles skip in the sink). A kick-off
            // consumed no inbound (cursorTo null) so it advances nothing.
            if (reply.cursorTo !== null) await this.threads.advanceCursor(threadId, reply.cursorTo, tx);
            // Rename once the household exists; stamp even for a DM (which no-ops on send) so it never
            // retries. Stamp the contact-card gate on the first answered turn. (Confetti/fireworks
            // effects removed — WI-4B deferred.)
            if (renameNow) await this.threads.markRenamed(threadId, new Date(), tx);
            if (cardNow) await this.threads.markCarded(threadId, new Date(), tx);
          });

          renamePending = renamePending && !renameNow; // fired once; don't re-rename a later turn
          cardPending = cardPending && !cardNow; // fired once; don't re-card a later turn
          // Rename the chat to "Meal Planning" once the roster is set (group only; DM no-ops).
          if (renameNow) await this.sender.renameChat(thread.chatGuid, 'Meal Planning');
          // Share Chef's contact card on the first message so the household can save her.
          if (cardNow) await this.sender.sendContactCard(thread.chatGuid);
          return { cursorTo: reply.cursorTo, popped: reply.popped };
        });
        if (outcome === null) return; // chef had nothing to answer — stop draining
        lastPopped = outcome.popped;
        if (outcome.cursorTo !== null) cursor = outcome.cursorTo; // advance past mid-turn arrivals
      }
    });
  }

  /**
   * Confirms the turn's explainer-ack `elicit` now that its bubbles are committing (send proves
   * delivery): marked `asked` the turn it is first delivered (status `unasked`), and `filled` on the
   * next inbound (its status is already `asked`) — the reply is the acknowledgment, unblocking the
   * gated tasks. Emits are NOT confirmed here — they complete in-loop via `tasks__update`.
   */
  private async confirmAcks(confirm: ConfirmTask[], tx: Tx): Promise<void> {
    const updates: TaskUpdate[] = confirm
      .filter((t) => t.kind === 'elicit')
      .map((t) => ({ taskId: t.taskId, status: t.status === 'asked' ? 'filled' : 'asked' }));
    if (updates.length) await this.objectives.applyTaskUpdates(updates, tx);
  }

  /**
   * AC-8 safety net. When a required `emit`'s content was delivered this turn but the model left it
   * unmarked (didn't fill it via `tasks__update`), mark it `filled` and, if the objective is now
   * complete, pop it — so the terminal onboarding flow can't stall waiting on an inbound that may
   * never come. Scoped strictly to a delivered, still-unmarked REQUIRED emit; the normal path pops
   * in-loop and this no-ops.
   */
  private async completeDeliveredEmit(confirm: ConfirmTask[], objectiveId: string, tx: Tx): Promise<void> {
    const unmarkedEmits = confirm.filter((t) => t.kind === 'emit' && t.status !== 'filled' && t.status !== 'defaulted');
    if (unmarkedEmits.length === 0) return;
    await this.objectives.applyTaskUpdates(unmarkedEmits.map((t) => ({ taskId: t.taskId, status: 'filled' as const })), tx);
    if (await this.objectives.isComplete(objectiveId, tx)) await this.objectives.completeAndPop(objectiveId, tx);
  }
}

/** A drizzle transaction client — the type each in-transaction repo write receives. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
