import type { Tool } from '@mastra/core/tools';
import type { Task } from '../../models/task.js';

/**
 * One turn's mutable DATA, shared by every tool built for that turn. A tool reads the current
 * `householdId`/`members` at execute time (not at build time), so `household__add_members` running earlier
 * in a turn flows the new roster to a later `save_*` in the same turn. Infra (the db, the
 * registries) is NOT here — each tool captures its own via `create(ctx, db)` (CLAUDE.md: tools
 * create their own dependencies), so this stays turn data only.
 */
export interface TurnContext {
  threadId: string;
  objectiveId: string;
  /** The handle of the person texting (the initiator/owner) — from the thread's owner. */
  initiatorHandle: string;
  /** The thread owner's user id — whose account an imported recipe is started for. */
  initiatorUserId: string;
  /** The triggering inbound message's Spectrum platform id (the link that started the turn),
   *  so an import link row can thread WI-2B's completion reply. Null when it has none. */
  triggerExternalId: string | null;
  /** The thread's household — created with the thread on first inbound, so set for every real turn
   *  (null only in a degenerate thread with no household row). */
  householdId: string | null;
  members: Array<{ userId: string; name?: string }>;
  /** The turn's loaded, eligible non-terminal tasks — what `tasks__update` resolves task ids against. */
  tasks: Task[];
}

/**
 * What a tool actually did: the normalized values that landed, and each value the model tried that
 * was refused (unknown enum, unconfirmed allergen, absent member), with the nearest valid ids when
 * they exist. Returned to the model in the tool-loop.
 */
export interface SaveResult {
  saved: Record<string, unknown>;
  rejected: Array<{ input: string; reason: string; closest?: string[] }>;
}

/**
 * A chef command, as a self-contained class. `static create(ctx, db)` wires its own repositories
 * from `db`; the instance binds to that turn's data. `asMastraTool()` returns the Mastra tool that
 * closes over the instance, so the native tool-loop calls straight into our services — nothing is
 * threaded through Mastra's context. `canRun()` is the prompt-time legality gate (context only, no
 * args).
 */
export interface ChefTool {
  readonly id: string;
  canRun(): boolean;
  asMastraTool(): Tool<any, any>;
}
