import type { Database } from '../db.js';
import { ObjectiveRepository } from '../chef/objective-repository.js';
import { HouseholdRepository } from '../repositories/household-repository.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectChefAgent, type ChefAgent } from '../chef/chef-agent.js';
import type { BriefingInput, TranscriptLine } from '../chef/briefing.js';
import type { ChatEvent } from '../chef/types.js';
import type { Task } from '../models/task.js';
import type { TurnContext } from '../chef/tools/types.js';
import { onboardingObjective, householdTaskSpecs } from '../chef/objectives/onboarding.js';

/** How many recent messages (both sides) the briefing shows as conversation context. */
const CONVERSATION_WINDOW = 20;
/** Cap the replied-to parent to a snippet — a Chef menu can be long, and only the referent matters. */
const MAX_REPLY_PARENT_SNIPPET = 280;

/**
 * The per-turn live outbound channel the Consumer hands the Chef (increment 2). Each `send` journals
 * the outbound row (tagged `trigger_id` + a deterministic guid) and flushes it live through the
 * `Sender`, idempotent under redelivery. The Chef threads it into the responder's `send` tool, so a
 * bubble ships mid-generation (an ack before deliberation, the result after) rather than one atomic
 * batch at end-of-turn.
 */
export interface OutboundSink {
  send(event: ChatEvent): Promise<void>;
}

/** One fact-less task eligible this turn that the consumer confirms at send-time: an `emit` (its
 *  bubbles just went out) or the explainer-ack `elicit` (asked now, filled by the next inbound). The
 *  model-filled `elicit` tasks set their own status in-loop; these are the code-confirmed ones. */
export interface ConfirmTask {
  taskId: string;
  kind: Task['kind'];
  status: Task['status'];
}

/** What the consumer commits for one turn — the Chef's bubbles already went out live via the sink,
 *  so this carries only the after-the-fact commit: task confirmations, the cursor, the objective it
 *  ran against, whether anything was delivered, and whether the objective popped in-loop. */
export interface ChefReply {
  /** Fact-less tasks the consumer confirms once the turn's bubbles send (the explainer-ack elicit). */
  confirmTasks: ConfirmTask[];
  /** The inbound id to advance the cursor to, or null for a kick-off turn (consumed no inbound). */
  cursorTo: string | null;
  /** The objective this turn ran against — the AC-8 safety net pops it if a required emit was
   *  delivered but left unmarked, and the consumer keys kick-off sends on it. */
  objectiveId: string;
  /** Whether any bubble was sent this turn (the sink flushed at least one) — gates the fact-less
   *  ack confirm and the AC-8 delivered-emit safety net. */
  delivered: boolean;
  /** Whether this turn completed and popped its objective (via `update_tasks` in-loop). The drain
   *  loop runs one more kick-off iteration against the newly-active objective when true. */
  popped: boolean;
}

/**
 * The consumer's entire view of the reasoning layer. `respond` loads the thread's own context,
 * reasons (validated tool writes land mid-turn), and sends its bubbles live through `sink` — then
 * returns what to commit (confirmations, cursor, delivered) or null when nothing past the cursor is
 * pending.
 */
export interface Chef {
  respond(threadId: string, sink: OutboundSink): Promise<ChefReply | null>;
}

/**
 * The live Chef. Loads its own turn context (active objective + unfilled slots, transcript,
 * members, pending inbound past the cursor), runs ONE agent (objective tools + `send`), and sends
 * each bubble live through the Consumer's `sink` (increment 2). No interruption restart: live sends
 * aren't discardable, so a message that lands mid-turn is picked up by the Consumer's next drain
 * iteration (Q-02 resolved in practice). Applies nothing to the outbox itself — it returns the reply.
 */
export class RealChef implements Chef {
  constructor(
    private readonly db: Database,
    private readonly agent: ChefAgent,
    private readonly objectives: ObjectiveRepository,
    private readonly threads: ThreadRepository,
    private readonly households: HouseholdRepository,
  ) {}

  static create(db: Database): RealChef {
    const threads = ThreadRepository.create(db);
    return new RealChef(
      db,
      selectChefAgent(),
      ObjectiveRepository.create(db),
      threads,
      HouseholdRepository.create(db),
    );
  }

  async respond(threadId: string, sink: OutboundSink): Promise<ChefReply | null> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return null;

    const turn = await this.loadTurn(thread.id, thread.householdId, thread.lastProcessedId, thread.ownerUserId);
    if (!turn) return null;

    // One agent runs the whole turn: it acks, calls the objective tools to persist what the household
    // said, and speaks — each bubble flushed live via the sink. `worked` (any mutating tool ran) gates
    // the fact-less confirm — a social, send-only turn confirms nothing. `delivered` records whether
    // any bubble actually shipped through the sink this turn.
    let delivered = false;
    const { worked } = await this.agent.run(
      {
        briefing: turn.briefing,
        ctx: turn.turnCtx,
        triggerExternalId: turn.triggerExternalId,
        messageTargets: turn.messageTargets,
        send: async (event) => {
          delivered = true;
          await sink.send(event);
        },
      },
      this.db,
    );

    // A social (no-work) turn advanced no task — confirm nothing (AC-5); a working turn confirms the
    // loaded fact-less tasks as before.
    const confirmTasks = worked ? turn.confirmTasks : [];
    // The turn popped its objective iff the one it ran against is no longer the active objective —
    // `update_tasks`'s in-loop completeAndPop either activated a sibling (different id) or emptied the
    // stack (null). Read after the run so the pop is visible.
    const stillActive = await this.objectives.loadActive(threadId);
    const popped = stillActive?.objective.id !== turn.objectiveId;
    return { confirmTasks, cursorTo: turn.cursorTo, objectiveId: turn.objectiveId, delivered, popped };
  }

  /**
   * Loads the active objective, slots, members, transcript, and pending inbound. Returns null when
   * there is neither pending inbound nor eligible active work to kick off (the thread parks). When
   * there is no pending inbound but the active objective still has eligible tasks, builds a
   * TRIGGERLESS kick-off turn (no trigger id, no targets, no pending line) so the model reads "here's
   * the next objective" and delivers/asks its opener.
   */
  private async loadTurn(threadId: string, householdId: string | null, cursor: string | null, ownerUserId: string) {
    const pending = await this.threads.loadPendingInbound(threadId, cursor);
    // A fresh thread has no objective — seed onboarding (its household slots) on the first inbound
    // so the conversation is resumable from the DB alone (F-01 step 2). Only on a real inbound: a
    // kick-off never seeds onboarding.
    let active = await this.objectives.loadActive(threadId);
    if (!active && pending.length > 0) {
      await this.objectives.pushObjective({ threadId, definition: onboardingObjective.id, tasks: householdTaskSpecs(), position: 'top' });
      active = await this.objectives.loadActive(threadId);
    }
    // Kick-off gate: with no pending inbound, run only when the active objective has eligible
    // non-terminal work; otherwise the thread has nothing to do — park.
    if (pending.length === 0 && (!active || active.tasks.length === 0)) return null;
    if (!active) return null;

    const members = householdId ? await this.households.loadMembers(householdId) : [];
    const briefingMembers = members.map((m) => ({ userId: m.userId, name: m.name ?? m.imessageHandle ?? '', handle: m.imessageHandle ?? '' }));
    // Show the recent conversation (both sides) for context, but tag only THIS turn's new household
    // messages [m#] — they're what to answer, and the only tapback-targetable ones. The [m#] → platform
    // id map lets a tapback ground on any of them without the model ever touching a raw id.
    const recent = await this.threads.loadRecentMessages(threadId, CONVERSATION_WINDOW);
    const pendingIds = new Set(pending.map((m) => m.id));
    // Sender id → name, so each household line is labelled with who spoke (undefined ⇒ "unknown").
    const nameByUser = new Map(members.map((m) => [m.userId, m.name ?? undefined]));
    const messageTargets: Record<string, string> = {};
    let tag = 0;
    const transcript: TranscriptLine[] = recent.map((m) => {
      const role: TranscriptLine['role'] = m.direction === 'inbound' ? 'household' : 'chef';
      const name = role === 'household' && m.senderUserId ? nameByUser.get(m.senderUserId) : undefined;
      if (role === 'household' && pendingIds.has(m.id)) {
        const handle = `m${(tag += 1)}`;
        if (m.externalId) messageTargets[handle] = m.externalId;
        return { role, text: m.body ?? '', handle, name };
      }
      return { role, text: m.body ?? '', name };
    });

    // A threaded reply (the trigger carries a parent guid) shows the model the message it answers.
    // A kick-off has no trigger — null everything trigger-derived (no parent, no external id).
    const trigger = pending.length > 0 ? pending[pending.length - 1]! : null;
    const parent = trigger?.targetMessageGuid
      ? await this.threads.findByPlatformId(threadId, trigger.targetMessageGuid)
      : null;

    const briefing: BriefingInput = {
      objective: active.objective,
      tasks: active.tasks,
      members: briefingMembers,
      transcript,
      trigger: pending.map((m) => m.body ?? '').join('\n'),
      replyingTo: parent?.body ? parent.body.slice(0, MAX_REPLY_PARENT_SNIPPET) : undefined,
    };
    const turnCtx: TurnContext = {
      threadId,
      objectiveId: active.objective.id,
      initiatorHandle: await this.threads.handleForUser(ownerUserId),
      initiatorUserId: ownerUserId,
      triggerExternalId: trigger?.externalId ?? null,
      householdId: householdId ?? null,
      members: members.map((m) => ({ userId: m.userId, name: m.name ?? undefined })),
      tasks: active.tasks,
    };
    // The fact-less eligible tasks the consumer confirms at send-time: every emit (delivered via the
    // reply plan) and the explainer-ack elicit (no domain fact). Model-filled elicits set their own
    // status in-loop, so they never appear here.
    const confirmTasks = active.tasks.filter((t) => t.fact === null).map((t) => ({ taskId: t.id, kind: t.kind, status: t.status }));
    // A kick-off consumes no inbound, so it has no cursor to advance to (`null`); a normal turn
    // advances to the newest pending id. The consumer skips the cursor advance when this is null.
    const cursorTo = trigger ? trigger.id : null;
    return { briefing, turnCtx, triggerExternalId: trigger?.externalId ?? null, messageTargets, cursorTo, confirmTasks, objectiveId: active.objective.id };
  }
}

/**
 * Dev/test double: a fixed one-bubble reply, no network. Reads the thread's pending inbound only
 * to set `cursorTo` (newest pending id) and to return null when nothing is pending; records that
 * it was reached (mirrors the inc-1 stub flag).
 */
export class StubChef implements Chef {
  private readonly threads: ThreadRepository;
  reasoningReached = false;

  constructor(db: Database) {
    this.threads = ThreadRepository.create(db);
  }

  async respond(threadId: string, sink: OutboundSink): Promise<ChefReply | null> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return null;
    const pending = await this.threads.loadPendingInbound(threadId, thread.lastProcessedId);
    if (pending.length === 0) return null;
    this.reasoningReached = true;
    await sink.send({ kind: 'text', text: "Hey! I'm your Harvest chef — what are you in the mood to cook?" });
    return {
      confirmTasks: [],
      cursorTo: pending[pending.length - 1]!.id,
      objectiveId: '', // the stub runs no objective
      delivered: true,
      popped: false, // the stub never completes an objective
    };
  }
}

/** The chef for the current env: the real Chef when a model key is set, else the offline stub. */
export function selectChef(db: Database): Chef {
  return process.env.GEMINI_API_KEY ? RealChef.create(db) : new StubChef(db);
}

// Re-exported through the facade so the consumer confirms a ChefReply's fact-less tasks atomically
// without importing the reasoning layer directly (its only agent import stays `./chef.js`).
export { ObjectiveRepository } from '../chef/objective-repository.js';
export type { TaskUpdate } from '../chef/objective-repository.js';

