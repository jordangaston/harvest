import type { Database } from '../db.js';
import { ObjectiveRepository } from '../chef/objective-repository.js';
import { HouseholdRepository } from '../repositories/household-repository.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectChefAgent, type ChefAgent } from '../chef/chef-agent.js';
import type { BriefingInput, TranscriptLine } from '../chef/briefing.js';
import type { ChatEvent } from '../chef/types.js';
import type { Task } from '../models/task.js';
import type { Objective } from '../models/objective.js';
import type { TurnContext } from '../chef/tools/types.js';
import { onboardingObjective, householdTaskSpecs } from '../chef/objectives/onboarding.js';
import { firstMealPlanObjective, firstMealPlanTaskSpecs } from '../chef/objectives/first-meal-plan.js';
import { reminderObjective } from '../chef/objectives/meal-reminder.js';
import { steadyStateObjective } from '../chef/objectives/steady-state.js';

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
   *  delivered but left unmarked, and the consumer keys kick-off sends on it. Null on a steady-state
   *  turn (no objective row on the stack — the household is done planning). */
  objectiveId: string | null;
  /** Whether any bubble was sent this turn (the sink flushed at least one) — gates the fact-less
   *  ack confirm and the AC-8 delivered-emit safety net. */
  delivered: boolean;
  /** Whether this turn completed and popped its objective (via `tasks__update` in-loop). The drain
   *  loop runs one more kick-off iteration against the newly-active objective when true. */
  popped: boolean;
}

/** The heartbeat intent (WI-02): the actionable task ids a bare-doorbell follow-up turn should
 *  advance — quiet `asked` tasks to nudge and eligible `unasked` tasks to ask. Folded into the turn
 *  context as one instruction line; absent on a normal (inbound-driven) turn. */
export interface HeartbeatIntent {
  taskIds: string[];
}

/** The reminder intent (meal-reminders WI-01): a due course to announce and today's planned recipes
 *  for it. Folded into the briefing as a one-line "announce tonight's dinner" instruction; absent on
 *  a normal or heartbeat turn. The consumer resolves today's plan under the lock before the turn. */
export interface ReminderIntent {
  meal: string;
  recipes: { title: string; url?: string }[];
}

/**
 * The consumer's entire view of the reasoning layer. `respond` loads the thread's own context,
 * reasons (validated tool writes land mid-turn), and sends its bubbles live through `sink` — then
 * returns what to commit (confirmations, cursor, delivered) or null when nothing past the cursor is
 * pending. `heartbeat` (WI-02) turns a bare doorbell into a proactive follow-up on the named tasks.
 */
export interface Chef {
  respond(threadId: string, sink: OutboundSink, heartbeat?: HeartbeatIntent, reminder?: ReminderIntent): Promise<ChefReply | null>;
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

  async respond(threadId: string, sink: OutboundSink, heartbeat?: HeartbeatIntent, reminder?: ReminderIntent): Promise<ChefReply | null> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return null;

    // A reminder turn (meal-reminders WI-01) is objective-independent — the consumer already resolved
    // today's plan under the lock, so the chef just announces it. It runs against the reminder shell
    // definition, consumes no inbound, and pops nothing.
    const turn = reminder
      ? await this.loadReminderTurn(thread.id, thread.householdId, thread.ownerUserId, reminder)
      : await this.loadTurn(thread.id, thread.householdId, thread.lastProcessedId, thread.ownerUserId, heartbeat);
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
    // loaded fact-less tasks as before. A reminder turn touches no objective, so it confirms/pops nothing.
    const confirmTasks = worked ? turn.confirmTasks : [];
    // The turn popped its objective iff the one it ran against is no longer the active objective —
    // `tasks__update`'s in-loop completeAndPop either activated a sibling (different id) or emptied the
    // stack (null). Read after the run so the pop is visible. A reminder or steady-state turn runs
    // against a shell, not a stack objective, so it never pops (a reminder is objective-independent by
    // construction; steady state reports a null `objectiveId`).
    const popped = !reminder && turn.objectiveId !== null && (await this.objectives.loadActive(threadId))?.objective.id !== turn.objectiveId;
    return { confirmTasks, cursorTo: turn.cursorTo, objectiveId: turn.objectiveId, delivered, popped };
  }

  /**
   * Loads the active objective, slots, members, transcript, and pending inbound. Returns null when
   * there is neither pending inbound nor eligible active work to kick off (the thread parks). When
   * there is no pending inbound but the active objective still has eligible tasks, builds a
   * TRIGGERLESS kick-off turn (no trigger id, no targets, no pending line) so the model reads "here's
   * the next objective" and delivers/asks its opener.
   */
  private async loadTurn(threadId: string, householdId: string | null, cursor: string | null, ownerUserId: string, heartbeat?: HeartbeatIntent) {
    const pending = await this.threads.loadPendingInbound(threadId, cursor);
    // FIRST CONTACT only: a thread with NO objectives at all gets onboarding seeded on its first
    // inbound, so the conversation is resumable from the DB alone (F-01 step 2). A thread whose stack
    // is merely empty (all objectives terminal) is a valid steady state — never re-seed it (WI-01
    // AC-1/AC-2). The check-then-seed runs under the consumer's per-thread lock, so it can't race.
    let active = await this.objectives.loadActive(threadId);
    if (!active && pending.length > 0 && !(await this.objectives.hasObjectives(threadId))) {
      // Seed onboarding active (top) and first_meal_plan suspended (bottom), so onboarding's pop
      // chains straight into the first-meal-plan kick-off (F-01 / meal-plan WI). The bottom push is
      // lock-free and never demotes the active onboarding.
      await this.objectives.pushObjective({ threadId, definition: onboardingObjective.id, tasks: householdTaskSpecs(), position: 'top' });
      await this.objectives.pushObjective({ threadId, definition: firstMealPlanObjective.id, tasks: firstMealPlanTaskSpecs(), position: 'bottom' });
      active = await this.objectives.loadActive(threadId);
    }
    // Steady state: the stack is empty (all objectives terminal) but the household messaged — answer
    // conversationally with the full tool set and no objective (WI-01 AC-2). A kick-off (no inbound)
    // against an empty stack still parks; only a real inbound gets a steady-state turn.
    if (!active) {
      if (pending.length === 0) return null;
      return this.loadSteadyStateTurn(threadId, householdId, ownerUserId, pending);
    }
    // Kick-off gate: with no pending inbound, run only when the active objective has eligible
    // non-terminal work; otherwise the thread has nothing to do — park.
    if (pending.length === 0 && active.tasks.length === 0) return null;

    return this.buildInboundTurn(threadId, householdId, ownerUserId, pending, active.objective, active.tasks, active.objective.id, active.objective.id, heartbeat);
  }

  /**
   * A steady-state turn (chef-steady-state WI-01): the thread's stack is empty (all objectives
   * terminal), but the household messaged. Answers conversationally against the `steady_state` shell
   * — full tool set, no tasks, no objective row — and advances the cursor like any inbound turn. The
   * returned `objectiveId` is null: there is no objective to pop, confirm, or key sends on. The turn
   * context carries the shell's definition id so its tools resolve (same shell mechanism as reminders).
   */
  private async loadSteadyStateTurn(threadId: string, householdId: string | null, ownerUserId: string, pending: Awaited<ReturnType<ThreadRepository['loadPendingInbound']>>) {
    const objective = { definition: steadyStateObjective.id } as Objective;
    return this.buildInboundTurn(threadId, householdId, ownerUserId, pending, objective, [], null, steadyStateObjective.id);
  }

  /**
   * Assembles one inbound turn's briefing, turn context, message-target map, cursor, and fact-less
   * confirm set from the loaded objective + eligible tasks. Shared by `loadTurn` (a real stack
   * objective) and `loadSteadyStateTurn` (the shell, no tasks). `replyObjectiveId` is what the reply
   * reports — the row id for a stack objective, null in steady state; `ctxObjectiveId` is what the
   * tools bind to (the row id for a real objective, the shell id in steady state). `heartbeat` folds
   * in only on a real objective.
   */
  private async buildInboundTurn(
    threadId: string,
    householdId: string | null,
    ownerUserId: string,
    pending: Awaited<ReturnType<ThreadRepository['loadPendingInbound']>>,
    objective: Objective,
    turnTasks: Task[],
    replyObjectiveId: string | null,
    ctxObjectiveId: string,
    heartbeat?: HeartbeatIntent,
  ) {
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
      objective,
      tasks: turnTasks,
      members: briefingMembers,
      transcript,
      trigger: pending.map((m) => m.body ?? '').join('\n'),
      replyingTo: parent?.body ? parent.body.slice(0, MAX_REPLY_PARENT_SNIPPET) : undefined,
      heartbeat: heartbeat && heartbeat.taskIds.length ? { taskIds: heartbeat.taskIds } : undefined,
    };
    const turnCtx: TurnContext = {
      threadId,
      objectiveId: ctxObjectiveId,
      initiatorHandle: await this.threads.handleForUser(ownerUserId),
      initiatorUserId: ownerUserId,
      triggerExternalId: trigger?.externalId ?? null,
      householdId: householdId ?? null,
      members: members.map((m) => ({ userId: m.userId, name: m.name ?? undefined })),
      tasks: turnTasks,
    };
    // The fact-less eligible tasks the consumer confirms at send-time: every emit (delivered via the
    // reply plan) and the explainer-ack elicit (no domain fact). Model-filled elicits set their own
    // status in-loop, so they never appear here.
    const confirmTasks = turnTasks.filter((t) => t.fact === null).map((t) => ({ taskId: t.id, kind: t.kind, status: t.status }));
    // A kick-off consumes no inbound, so it has no cursor to advance to (`null`); a normal turn
    // advances to the newest pending id. The consumer skips the cursor advance when this is null.
    const cursorTo = trigger ? trigger.id : null;
    return { briefing, turnCtx, triggerExternalId: trigger?.externalId ?? null, messageTargets, cursorTo, confirmTasks, objectiveId: replyObjectiveId };
  }

  /**
   * Builds an objective-independent reminder turn (meal-reminders WI-01): the reminder shell
   * definition, no tasks, the recent transcript for tone, and the `reminder` intent (the course +
   * today's planned recipes the consumer resolved). Consumes no inbound (`cursorTo` null) and pops
   * nothing — the returned `objectiveId` is the shell id (no `objectives` row exists for it).
   */
  private async loadReminderTurn(threadId: string, householdId: string | null, ownerUserId: string, reminder: ReminderIntent) {
    const members = householdId ? await this.households.loadMembers(householdId) : [];
    const briefingMembers = members.map((m) => ({ userId: m.userId, name: m.name ?? m.imessageHandle ?? '', handle: m.imessageHandle ?? '' }));
    const nameByUser = new Map(members.map((m) => [m.userId, m.name ?? undefined]));
    const recent = await this.threads.loadRecentMessages(threadId, CONVERSATION_WINDOW);
    const transcript: TranscriptLine[] = recent.map((m) => ({
      role: m.direction === 'inbound' ? 'household' : 'chef',
      text: m.body ?? '',
      name: m.direction === 'inbound' && m.senderUserId ? nameByUser.get(m.senderUserId) : undefined,
    }));

    const objective = { definition: reminderObjective.id } as Objective;
    const briefing: BriefingInput = { objective, tasks: [], members: briefingMembers, transcript, trigger: '', reminder };
    const turnCtx: TurnContext = {
      threadId,
      objectiveId: reminderObjective.id,
      initiatorHandle: await this.threads.handleForUser(ownerUserId),
      initiatorUserId: ownerUserId,
      triggerExternalId: null,
      householdId: householdId ?? null,
      members: members.map((m) => ({ userId: m.userId, name: m.name ?? undefined })),
      tasks: [],
    };
    return { briefing, turnCtx, triggerExternalId: null, messageTargets: {}, cursorTo: null, confirmTasks: [], objectiveId: reminderObjective.id };
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

  async respond(threadId: string, sink: OutboundSink, _heartbeat?: HeartbeatIntent, _reminder?: ReminderIntent): Promise<ChefReply | null> {
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

