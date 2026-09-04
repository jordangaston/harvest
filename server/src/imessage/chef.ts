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
 *  so this carries only the after-the-fact commit: task confirmations, the cursor, the objective to
 *  pop, and whether anything was actually delivered. */
export interface ChefReply {
  /** Fact-less tasks the consumer confirms once the turn's bubbles send (emit + explainer-ack). */
  confirmTasks: ConfirmTask[];
  cursorTo: string;
  /** The active objective this turn ran against — the consumer pops it if it just completed. */
  objectiveId: string;
  /** Whether any bubble was sent this turn (the sink flushed at least one) — gates the fact-less
   *  confirm + completion pop, which may only fire when the close was actually delivered. */
  delivered: boolean;
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
    return { confirmTasks, cursorTo: turn.cursorTo, objectiveId: turn.objectiveId, delivered };
  }

  /** Loads the active objective, slots, members, transcript, and pending inbound. Null if nothing pending. */
  private async loadTurn(threadId: string, householdId: string | null, cursor: string | null, ownerUserId: string) {
    const pending = await this.threads.loadPendingInbound(threadId, cursor);
    if (pending.length === 0) return null;
    // A fresh thread has no objective — seed onboarding (its household slots) on the first inbound
    // so the conversation is resumable from the DB alone (F-01 step 2).
    let active = await this.objectives.loadActive(threadId);
    if (!active) {
      await this.objectives.pushObjective({ threadId, definition: onboardingObjective.id, tasks: householdTaskSpecs(), position: 'top' });
      active = await this.objectives.loadActive(threadId);
    }
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
    const trigger = pending[pending.length - 1]!;
    const parent = trigger.targetMessageGuid
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
      triggerExternalId: trigger.externalId ?? null,
      householdId: householdId ?? null,
      members: members.map((m) => ({ userId: m.userId, name: m.name ?? undefined })),
      tasks: active.tasks,
    };
    // The fact-less eligible tasks the consumer confirms at send-time: every emit (delivered via the
    // reply plan) and the explainer-ack elicit (no domain fact). Model-filled elicits set their own
    // status in-loop, so they never appear here.
    const confirmTasks = active.tasks.filter((t) => t.fact === null).map((t) => ({ taskId: t.id, kind: t.kind, status: t.status }));
    return { briefing, turnCtx, triggerExternalId: trigger.externalId, messageTargets, cursorTo: pending[pending.length - 1]!.id, confirmTasks, objectiveId: active.objective.id };
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
      objectiveId: '', // the stub runs no objective — the consumer's pop is a no-op on a blank id
      delivered: true,
    };
  }
}

/** The chef for the current env: the real Chef when a model key is set, else the offline stub. */
export function selectChef(db: Database): Chef {
  return process.env.DEEPSEEK_API_KEY ? RealChef.create(db) : new StubChef(db);
}

// Re-exported through the facade so the consumer confirms a ChefReply's fact-less tasks atomically
// without importing the reasoning layer directly (its only agent import stays `./chef.js`).
export { ObjectiveRepository } from '../chef/objective-repository.js';
export type { TaskUpdate } from '../chef/objective-repository.js';

