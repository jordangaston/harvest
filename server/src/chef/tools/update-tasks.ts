import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFact } from '../facts/write-fact.js';
import { ObjectiveRepository } from '../objective-repository.js';
import type { Subject } from '../facts/fact-type.js';
import type { Task } from '../../models/task.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

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
 * Fills the active objective's `elicit` tasks the model has answers for. Resolves each `task_id` in
 * the turn's loaded tasks → its `fact`/`factType`/subject, routes the value through `writeFact`, and
 * on success sets the task `filled`. Batch every eligible task in one call; a `solo` task must be
 * sent alone (a batch containing one rejects). Reports per-task status and whether the objective is
 * now complete.
 */
export class UpdateTasksTool implements ChefTool {
  readonly id = 'update_tasks';
  readonly saved: SaveResult[] = [];
  private readonly objectives: ObjectiveRepository;

  private constructor(private readonly ctx: TurnContext) {
    this.objectives = ObjectiveRepository.create(ctx.db);
  }

  static create(ctx: TurnContext): UpdateTasksTool {
    return new UpdateTasksTool(ctx);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Fill the objective tasks you now have answers for. Address each by the [id] in the briefing: ' +
        'updates:[{ task_id, value }]. Batch every task you can answer this turn into one call — except ' +
        'a task marked solo, which must be sent by itself. Returns per-task status and objectiveComplete.',
      inputSchema,
      execute: async ({ updates }) => this.run(updates),
    });
  }

  async run(updates: { task_id: string; value: unknown }[]): Promise<{ results: TaskWriteResult[]; objectiveComplete: boolean }> {
    const byId = new Map(this.ctx.tasks.map((t) => [t.id, t]));
    const resolved = updates.map((u) => ({ update: u, task: byId.get(u.task_id) }));

    const soloInBatch = updates.length > 1 && resolved.some((r) => r.task?.solo);
    if (soloInBatch) {
      const results = updates.map<TaskWriteResult>((u) => ({ task_id: u.task_id, status: 'rejected', reason: 'a solo task must be sent alone, not batched with others' }));
      return { results, objectiveComplete: await this.objectives.isComplete(this.ctx.objectiveId) };
    }

    const results: TaskWriteResult[] = [];
    for (const { update, task } of resolved) results.push(await this.fillOne(update.task_id, update.value, task));
    return { results, objectiveComplete: await this.objectives.isComplete(this.ctx.objectiveId) };
  }

  private async fillOne(taskId: string, value: unknown, task?: Task): Promise<TaskWriteResult> {
    if (!task) return { task_id: taskId, status: 'rejected', reason: 'not an eligible task this turn' };
    if (task.kind !== 'elicit' || !task.factType) return { task_id: taskId, status: 'rejected', reason: 'not a fillable elicit task' };

    const type = this.ctx.factTypes.get(task.factType);
    if (!type) return { task_id: taskId, status: 'rejected', reason: `no fact type "${task.factType}"` };

    const subject = this.subjectFor(task);
    if (!subject) return { task_id: taskId, status: 'rejected', reason: 'task has no household or member to write to' };

    // ponytail: the fact write (ctx.db, self-transacting) and the status set run in SEPARATE
    // transactions on purpose — a repo-backed persist opens its own tx, so nesting them would
    // deadlock libSQL. Non-atomic but idempotent/retriable: a fill re-runs cleanly if the status
    // set is lost, and the status set is a plain UPDATE by id.
    const res = await writeFact(type, subject, value, this.ctx.db);
    if (!res.ok) return { task_id: taskId, status: 'rejected', reason: res.reason, missing: res.missing, closest: res.closest };

    await this.ctx.db.transaction((tx) => this.objectives.applyTaskUpdates([{ taskId, status: 'filled' }], tx));
    this.saved.push({ saved: { [task.fact ?? task.factType]: res.value }, rejected: [] });
    return { task_id: taskId, status: 'filled' };
  }

  /** The subject a task's fact writes to, from its scope + member. */
  private subjectFor(task: Task): Subject | null {
    if (task.scope === 'household') return this.ctx.householdId ? { scope: 'household', householdId: this.ctx.householdId } : null;
    return task.memberUserId ? { scope: 'member', userId: task.memberUserId } : null;
  }
}
