import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { objectives, tasks } from '../schema.js';
import { ObjectiveSchema, type Objective } from '../models/objective.js';
import { TaskSchema, type Task } from '../models/task.js';

/** A drizzle transaction client — the type passed to each write in a transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A definition's task spec, inserted at status `unasked`. `key` is a definition-local handle
 * used only to resolve `after` → the inserted rows' ids; it is not persisted. An `elicit` task
 * names a `fact` (+ `factType`); an `emit` leaves them unset.
 */
export interface TaskSpec {
  key: string;
  kind: 'elicit' | 'emit';
  fact?: string;
  factType?: string;
  scope: 'household' | 'member';
  memberUserId?: string;
  required: boolean;
  solo?: boolean;
  /** Sibling task keys this task is gated behind — eligible only once all are terminal. */
  after?: string[];
  /** Definition-local fill guidance, surfaced in the briefing; not persisted on the task row. */
  guidance?: string;
}

export interface PushObjectiveInput {
  threadId: string;
  definition: string;
  tasks: TaskSpec[];
  position: 'top' | 'bottom';
}

/** One declared task status change from the reasoning component. */
export interface TaskUpdate {
  taskId: string;
  status: Task['status'];
}

const TERMINAL = ['filled', 'defaulted'] as const;
const isTerminal = (status: Task['status']) => (TERMINAL as readonly string[]).includes(status);

/**
 * Data access for the objective stack (`objectives`) and its tasks (`tasks`). The turn loads the
 * active objective + its eligible non-terminal tasks, applies the reasoning component's task-status
 * updates (`applyTaskUpdates`), and on completion pops the objective and activates the next.
 */
export class ObjectiveRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new ObjectiveRepository(db);
  }

  /**
   * Loads the thread's `active` objective and its **eligible, non-terminal** tasks: terminal tasks
   * (`filled`/`defaulted`) are excluded, then a task is kept only when every id in its `afterTaskIds`
   * references a terminal task in the loaded full set — a dangling id fails closed (task stays gated).
   * Read-only.
   * @returns The objective + its eligible tasks, or null when no objective is active.
   */
  async loadActive(threadId: string): Promise<{ objective: Objective; tasks: Task[] } | null> {
    const [row] = await this.db
      .select()
      .from(objectives)
      .where(and(eq(objectives.threadId, threadId), eq(objectives.status, 'active')));
    if (!row) return null;
    const objective = ObjectiveSchema.parse(row);

    const all = (await this.db.select().from(tasks).where(eq(tasks.objectiveId, objective.id))).map((t) => TaskSchema.parse(t));
    const terminalIds = new Set(all.filter((t) => isTerminal(t.status)).map((t) => t.id));

    // ponytail: solo-exclusive rule. A pending required `solo` task (the explainer-ack) is exclusive
    // — while it is non-terminal ONLY solo tasks are eligible, so member tasks instantiated later gate
    // behind it without after-key resolution across instantiation calls (TaskSpec.key isn't persisted).
    // This replaces the ineffective static `after:[EXPLAINER_ACK_KEY]` those rows can't resolve to.
    const soloPending = all.some((t) => t.solo && t.required && !isTerminal(t.status));

    // ponytail: "close fires last" rule. A required `emit` (the onboarding close) is eligible only
    // when every required `elicit` currently loaded is terminal — its static `after` can't name member
    // tasks that don't exist at seed time, so gate it in code here. Generalization point for a future
    // multi-emit objective: order emits among themselves via `after` and keep this last-elicit gate.
    const requiredElicitsDone = all.every((t) => !(t.kind === 'elicit' && t.required) || isTerminal(t.status));

    const eligible = all.filter((t) => {
      if (isTerminal(t.status)) return false;
      if (!t.afterTaskIds.every((id) => terminalIds.has(id))) return false;
      if (soloPending && !t.solo) return false;
      if (t.kind === 'emit' && t.required && !requiredElicitsDone) return false;
      return true;
    });
    return { objective, tasks: eligible };
  }

  /**
   * Inserts an objective plus its task rows. A `top` push runs under the turn lock: it demotes the
   * current active first, then inserts `active` at `MAX(stack_position)+1`. A `bottom` push is the
   * lock-free background insert — `suspended` at `MIN-1`, no demotion. An empty stack always yields
   * an `active` objective at position 0. Each spec's `after` keys resolve to the inserted rows' ids.
   * @returns The inserted objective, parsed.
   */
  async pushObjective(input: PushObjectiveInput, tx?: Tx): Promise<Objective> {
    return tx ? this.insertObjective(input, tx) : this.db.transaction((t) => this.insertObjective(input, t));
  }

  private async insertObjective(input: PushObjectiveInput, tx: Tx): Promise<Objective> {
    const bounds = await tx
      .select({ max: sql<number | null>`max(${objectives.stackPosition})`, min: sql<number | null>`min(${objectives.stackPosition})` })
      .from(objectives)
      .where(eq(objectives.threadId, input.threadId));
    const { max, min } = bounds[0]!;

    const empty = max === null;
    // ponytail: MAX(stack_position)+1 read-then-write is safe only because a top-push runs under the
    // per-thread lock; a background (bottom) push is INSERT-only so it needs no lock. Don't move the
    // top-push off the lock without a fence.
    const active = empty || input.position === 'top';
    const stackPosition = empty ? 0 : input.position === 'top' ? max! + 1 : min! - 1;

    if (active && !empty)
      await tx.update(objectives).set({ status: 'suspended' }).where(and(eq(objectives.threadId, input.threadId), eq(objectives.status, 'active')));

    const [row] = await tx
      .insert(objectives)
      .values({ threadId: input.threadId, definition: input.definition, status: active ? 'active' : 'suspended', stackPosition })
      .returning();
    const objective = ObjectiveSchema.parse(row);

    if (input.tasks.length) await this.insertTasks(objective.id, input.tasks, tx);
    return objective;
  }

  /** Inserts task rows, then rewrites each row's `after_task_ids` from sibling keys → inserted ids. */
  private async insertTasks(objectiveId: string, specs: TaskSpec[], tx: Tx): Promise<void> {
    const inserted = await tx
      .insert(tasks)
      .values(specs.map((s) => this.taskRow(objectiveId, s)))
      .returning({ id: tasks.id });
    const idByKey = new Map(specs.map((s, i) => [s.key, inserted[i]!.id]));
    await Promise.all(
      specs.map((s, i) =>
        s.after?.length
          ? tx.update(tasks).set({ afterTaskIds: s.after.map((k) => idByKey.get(k)).filter((id): id is string => !!id) }).where(eq(tasks.id, inserted[i]!.id))
          : Promise.resolve(),
      ),
    );
  }

  /** One task insert row from a spec (before `after` resolution). */
  private taskRow(objectiveId: string, s: TaskSpec) {
    return {
      objectiveId,
      kind: s.kind,
      fact: s.fact ?? null,
      factType: s.factType ?? null,
      scope: s.scope,
      memberUserId: s.memberUserId ?? null,
      required: s.required,
      status: 'unasked' as const,
      solo: s.solo ?? false,
    };
  }

  /**
   * Applies the reasoning component's task-status updates within the turn's transaction — status
   * only. Value validation lives in `writeFact` (WI-2); this method just transitions status by id.
   */
  async applyTaskUpdates(updates: TaskUpdate[], tx: Tx): Promise<void> {
    for (const update of updates) await tx.update(tasks).set({ status: update.status }).where(eq(tasks.id, update.taskId));
  }

  /**
   * Instantiates member-scoped task rows for one identified member, idempotent on the unique
   * `(objective_id, fact, member_user_id)` index — re-identifying a member is a no-op. Called by
   * the identity flow as each membership is created, never as an atomic batch.
   */
  async instantiateMemberTasks(objectiveId: string, specs: TaskSpec[], tx: Tx): Promise<void> {
    if (!specs.length) return;
    await tx
      .insert(tasks)
      .values(specs.map((s) => this.taskRow(objectiveId, s)))
      .onConflictDoNothing({ target: [tasks.objectiveId, tasks.fact, tasks.memberUserId] });
  }

  /**
   * Marks one household-scoped task `filled`, resolving it by fact key on the objective. Used by the
   * identity flow to fill `household.same_household` once the household exists.
   */
  async markTaskFilled(objectiveId: string, fact: string, tx: Tx): Promise<void> {
    await tx.update(tasks).set({ status: 'filled' }).where(and(eq(tasks.objectiveId, objectiveId), eq(tasks.fact, fact)));
  }

  /**
   * Marks the objective `complete` (with `completed_at`), then activates the
   * highest-`stack_position` `suspended` sibling on the same thread. Because the completed
   * row is no longer active, activating the next never trips the one-active index. The activated
   * successor is stamped `kickoff_pending` (in `context`), a durable marker the consumer's drain loop
   * uses to resume a stranded kick-off after a crash between this pop and its opener (spec AC-7); the
   * consumer clears it once the opener delivers.
   * @returns The newly-activated objective, or null when the stack is now empty.
   */
  async completeAndPop(objectiveId: string, tx: Tx): Promise<Objective | null> {
    const [done] = await tx.select({ threadId: objectives.threadId }).from(objectives).where(eq(objectives.id, objectiveId));
    if (!done) return null;
    await tx.update(objectives).set({ status: 'complete', completedAt: new Date() }).where(eq(objectives.id, objectiveId));

    const [next] = await tx
      .select()
      .from(objectives)
      .where(and(eq(objectives.threadId, done.threadId), eq(objectives.status, 'suspended')))
      .orderBy(desc(objectives.stackPosition))
      .limit(1);
    if (!next) return null;
    const context = { ...(next.context ?? {}), kickoffPendingAt: new Date().toISOString() };
    await tx.update(objectives).set({ status: 'active', context }).where(eq(objectives.id, next.id));
    return ObjectiveSchema.parse({ ...next, status: 'active', context });
  }

  /**
   * Clears the kickoff-pending marker on an objective once its kick-off opener has delivered — so a
   * later bare doorbell no longer re-enters it (spec AC-7). Idempotent: a no-op if already clear.
   */
  async clearKickoffPending(objectiveId: string, tx: Tx): Promise<void> {
    const [row] = await tx.select({ context: objectives.context }).from(objectives).where(eq(objectives.id, objectiveId));
    if (!row?.context || row.context.kickoffPendingAt === undefined) return;
    const { kickoffPendingAt: _drop, ...rest } = row.context;
    await tx.update(objectives).set({ context: rest }).where(eq(objectives.id, objectiveId));
  }

  /**
   * True when the objective has zero required, non-terminal tasks (`filled`/`defaulted` are
   * terminal), counting both kinds. Optional tasks never block completion. Read-only.
   */
  async isComplete(objectiveId: string, tx?: Tx): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .select({ open: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.objectiveId, objectiveId), eq(tasks.required, true), sql`${tasks.status} not in ('filled','defaulted')`));
    return (row?.open ?? 0) === 0;
  }
}
