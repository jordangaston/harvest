import type { Database } from '../db.js';
import { ObjectiveStore, type SlotUpdate } from '../chef/objective-store.js';
import { HouseholdRepository } from '../repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../repositories/household-preference-repository.js';
import { PreferenceRepository } from '../repositories/preference-repository.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { TasteOptionsService } from '../services/taste-options-service.js';
import { selectReasoningAgent, type Reasoner } from '../chef/reasoning-agent.js';
import { selectResponseAgent, type Responder } from '../chef/response-agent.js';
import type { BriefingInput, TranscriptLine } from '../chef/briefing.js';
import type { ChatEvent } from '../chef/types.js';
import type { ToolCtx } from '../chef/tools/types.js';

const MAX_TURN_TRANSCRIPT = 12;
const MAX_INTERRUPT_RESTARTS = 2;

/** What the consumer commits and sends for one turn — the Chef's entire output. */
export interface ChefReply {
  chatEvents: ChatEvent[];
  slotUpdates: SlotUpdate[];
  cursorTo: string;
}

/**
 * The consumer's entire view of the reasoning layer. `respond` loads the thread's own context,
 * reasons (validated tool writes land mid-turn), renders the reply, clears the interruption
 * barrier, and returns what to commit and send — or null when nothing past the cursor is pending.
 */
export interface Chef {
  respond(threadId: string): Promise<ChefReply | null>;
}

/**
 * The live Chef. Loads its own turn context (active objective + unfilled slots, transcript,
 * members, pending inbound past the cursor), runs reasoning → response, then the interruption
 * barrier: a newer inbound discards the render and restarts against the fuller conversation,
 * bounded at 2. Applies nothing to the outbox itself — it returns the reply; the consumer commits it.
 */
export class RealChef implements Chef {
  constructor(
    private readonly db: Database,
    private readonly reasoner: Reasoner,
    private readonly responder: Responder,
    private readonly objectives: ObjectiveStore,
    private readonly threads: ThreadRepository,
    private readonly households: HouseholdRepository,
    private readonly isInterrupted: (threadId: string, loadedCursor: string) => Promise<boolean>,
  ) {}

  static create(db: Database): RealChef {
    const threads = ThreadRepository.create(db);
    return new RealChef(
      db,
      selectReasoningAgent(),
      selectResponseAgent(),
      ObjectiveStore.create(db),
      threads,
      HouseholdRepository.create(db),
      (threadId, cursor) => threads.hasInboundPast(threadId, cursor),
    );
  }

  async respond(threadId: string): Promise<ChefReply | null> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return null;

    for (let attempt = 0; ; attempt++) {
      const turn = await this.loadTurn(thread.id, thread.householdId, thread.lastProcessedId);
      if (!turn) return null;

      const reasoning = await this.reasoner.run(turn.briefing, turn.ctx);
      const chatEvents = await this.responder.render(reasoning.replyPlan, turn.transcriptWindow);

      // Interruption barrier: a message that landed while we reasoned discards this render and
      // restarts against the fuller conversation, up to MAX_INTERRUPT_RESTARTS, then returns anyway.
      if (attempt < MAX_INTERRUPT_RESTARTS && (await this.isInterrupted(thread.id, turn.cursorTo))) continue;

      return { chatEvents, slotUpdates: this.mapSlotUpdates(reasoning.slotUpdates, turn.slotIdByKey), cursorTo: turn.cursorTo };
    }
  }

  /** Loads the active objective, slots, members, transcript, and pending inbound. Null if nothing pending. */
  private async loadTurn(threadId: string, householdId: string | null, cursor: string | null) {
    const pending = await this.threads.loadPendingInbound(threadId, cursor);
    if (pending.length === 0) return null;
    const active = await this.objectives.loadActive(threadId);
    if (!active) return null;

    const members = householdId ? await this.households.loadMembers(householdId) : [];
    const briefingMembers = members.map((m) => ({ userId: m.userId, name: m.name ?? m.imessageHandle ?? '', handle: m.imessageHandle ?? '' }));
    const transcriptWindow = pending.map((m) => m.body ?? '');
    const transcript: TranscriptLine[] = transcriptWindow.map((text) => ({ role: 'household', text }));
    const state = { householdId: householdId ?? '', members: members.map((m) => ({ userId: m.userId })) };

    const briefing: BriefingInput = {
      state,
      objective: active.objective,
      slots: active.slots,
      members: briefingMembers,
      transcript: transcript.slice(-MAX_TURN_TRANSCRIPT),
      trigger: transcriptWindow.join('\n'),
    };
    const ctx: ToolCtx = {
      state,
      householdPrefs: HouseholdPreferenceRepository.create(this.db),
      memberPrefs: PreferenceRepository.create(this.db),
      taste: TasteOptionsService.create(this.db),
    };
    const slotIdByKey = new Map(active.slots.map((s) => [s.key, s.id]));
    return { briefing, ctx, transcriptWindow, cursorTo: pending[pending.length - 1]!.id, slotIdByKey };
  }

  /** Maps the reasoning component's key-scoped slot declarations to the store's slotId-scoped updates. */
  private mapSlotUpdates(updates: { key: string; status: SlotUpdate['status'] }[], slotIdByKey: Map<string, string>): SlotUpdate[] {
    return updates.flatMap((u) => {
      const slotId = slotIdByKey.get(u.key);
      return slotId ? [{ slotId, status: u.status }] : [];
    });
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

  async respond(threadId: string): Promise<ChefReply | null> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return null;
    const pending = await this.threads.loadPendingInbound(threadId, thread.lastProcessedId);
    if (pending.length === 0) return null;
    this.reasoningReached = true;
    return {
      chatEvents: [{ kind: 'text', text: "Hey! I'm your Harvest chef — what are you in the mood to cook?" }],
      slotUpdates: [],
      cursorTo: pending[pending.length - 1]!.id,
    };
  }
}

/** The chef for the current env: the real Chef when a model key is set, else the offline stub. */
export function selectChef(db: Database): Chef {
  return process.env.DEEPSEEK_API_KEY ? RealChef.create(db) : new StubChef(db);
}

// Re-exported through the facade so the consumer commits a ChefReply's slotUpdates atomically
// without importing the reasoning layer directly (its only agent import stays `./chef.js`).
export { ObjectiveStore } from '../chef/objective-store.js';

