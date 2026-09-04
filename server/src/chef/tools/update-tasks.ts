import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { writeFact } from '../facts/write-fact.js';
import { FactTypeRegistry } from '../facts/fact-types.js';
import { ObjectiveRepository } from '../objective-repository.js';
import type { Subject } from '../facts/fact-type.js';
import type { Task } from '../../models/task.js';
import type { ChefTool, TurnContext } from './types.js';

const inputSchema = z.object({
  updates: z.array(z.object({ task_id: z.string(), value: z.unknown() })),
});

/** One task fill's verdict, echoing the task id. */
interface TaskWriteResult {
  task_id: string;
  status: 'filled' | 'rejected';
  reason?: string;
  missing?: string[];
  closest?: string[];
}

/**
 * Fills the active objective's tasks the model has answers for. An `elicit` resolves its
 * `fact`/`factType`/subject and routes the value through `writeFact`; an `emit` (delivered content,
 * no fact) is simply marked `filled`. Batch every eligible task in one call; a `solo` task must be
 * sent alone (a batch containing one rejects). After the fills, if every required task is terminal
 * the objective completes and pops in-loop, so the model learns it finished and stops. Reports
 * per-task status and whether the objective is now complete/popped.
 */
export class UpdateTasksTool implements ChefTool {
  readonly id = 'tasks__update';
  private readonly db: Database;
  private readonly objectives: ObjectiveRepository;
  private readonly factTypes: FactTypeRegistry;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.db = db;
    this.objectives = ObjectiveRepository.create(db);
    this.factTypes = FactTypeRegistry.create(db);
  }

  static create(ctx: TurnContext, db: Database): UpdateTasksTool {
    return new UpdateTasksTool(ctx, db);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Fill the objective tasks you now have answers for, each by its [id] from the briefing. Batch ' +
        'every task you can answer this turn into one call — except a task marked (solo), which must go ' +
        'alone (a batch with one is rejected). For something the household mentions that no task asks ' +
        'about, use facts__update instead. Returns each task filled/rejected (with the reason and ' +
        'closest valid values) and whether the objective is now complete (and popped — if so, stop ' +
        'working it, it is done).',
      inputSchema,
      execute: async ({ updates }) => this.run(updates),
    });
  }

  async run(updates: { task_id: string; value: unknown }[]): Promise<{ results: TaskWriteResult[]; objectiveComplete: boolean; popped: boolean }> {
    const byId = new Map(this.ctx.tasks.map((t) => [t.id, t]));
    const resolved = updates.map((u) => ({ update: u, task: byId.get(u.task_id) }));

    const soloInBatch = updates.length > 1 && resolved.some((r) => r.task?.solo);
    if (soloInBatch) {
      const results = updates.map<TaskWriteResult>((u) => ({ task_id: u.task_id, status: 'rejected', reason: 'a solo task must be sent alone, not batched with others' }));
      return { results, objectiveComplete: await this.objectives.isComplete(this.ctx.objectiveId), popped: false };
    }

    const results: TaskWriteResult[] = [];
    const emitFilled: string[] = []; // emit fills defer their status set into the completion txn below
    for (const { update, task } of resolved) {
      const r = await this.fillOne(update.task_id, update.value, task);
      results.push(r);
      if (r.status === 'filled' && task?.kind === 'emit') emitFilled.push(update.task_id);
    }

    // An emit fill has no `writeFact`, so its status set can share ONE transaction with the completion
    // check + pop — no nested-tx/libSQL-deadlock conflict (unlike the elicit path, whose writeFact runs
    // in its own tx). Set the emit(s) filled, then complete-and-pop iff the objective is now done.
    let objectiveComplete = false;
    let popped = false;
    await this.db.transaction(async (tx) => {
      if (emitFilled.length) await this.objectives.applyTaskUpdates(emitFilled.map((taskId) => ({ taskId, status: 'filled' as const })), tx);
      objectiveComplete = await this.objectives.isComplete(this.ctx.objectiveId, tx);
      if (objectiveComplete) {
        await this.objectives.completeAndPop(this.ctx.objectiveId, tx);
        popped = true;
      }
    });
    return { results, objectiveComplete, popped };
  }

  private async fillOne(taskId: string, value: unknown, task?: Task): Promise<TaskWriteResult> {
    if (!task) return { task_id: taskId, status: 'rejected', reason: 'not an eligible task this turn' };
    // An emit delivers content — no fact to write. Mark it filled (status set deferred to run's
    // completion txn); its bubbles ship via the send tool.
    if (task.kind === 'emit') return { task_id: taskId, status: 'filled' };
    if (task.kind !== 'elicit' || !task.factType) return { task_id: taskId, status: 'rejected', reason: 'not a fillable elicit task' };

    const type = this.factTypes.get(task.factType);
    if (!type) return { task_id: taskId, status: 'rejected', reason: `no fact type "${task.factType}"` };

    const subject = this.subjectFor(task);
    if (!subject) return { task_id: taskId, status: 'rejected', reason: 'task has no household or member to write to' };

    // ponytail: the fact write (ctx.db, self-transacting) and the status set run in SEPARATE
    // transactions on purpose — a repo-backed persist opens its own tx, so nesting them would
    // deadlock libSQL. Non-atomic but idempotent/retriable: a fill re-runs cleanly if the status
    // set is lost, and the status set is a plain UPDATE by id.
    const res = await writeFact(type, subject, value, this.db);
    if (!res.ok) return { task_id: taskId, status: 'rejected', reason: res.reason, missing: res.missing, closest: res.closest };

    await this.db.transaction((tx) => this.objectives.applyTaskUpdates([{ taskId, status: 'filled' }], tx));
    return { task_id: taskId, status: 'filled' };
  }

  /** The subject a task's fact writes to, from its scope + member. */
  private subjectFor(task: Task): Subject | null {
    if (task.scope === 'household') return this.ctx.householdId ? { scope: 'household', householdId: this.ctx.householdId } : null;
    return task.memberUserId ? { scope: 'member', userId: task.memberUserId } : null;
  }
}
