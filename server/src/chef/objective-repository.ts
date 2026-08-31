import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { objectives, slots } from '../schema.js';
import { ObjectiveSchema, type Objective } from '../models/objective.js';
import { SlotSchema, type Slot } from '../models/slot.js';

/** A drizzle transaction client — the type passed to each write in a transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The definition's slot specs, inserted at status `unasked`. */
export interface SlotSpec {
  key: string;
  scope: 'household' | 'member';
  memberUserId?: string;
  required: boolean;
}

export interface PushObjectiveInput {
  threadId: string;
  definition: string;
  slots: SlotSpec[];
  position: 'top' | 'bottom';
}

/** One declared slot status change from the reasoning component. */
export interface SlotUpdate {
  slotId: string;
  status: Slot['status'];
  value?: unknown;
}

/**
 * Data access for the objective stack (`objectives`) and its slot scoreboard (`slots`).
 * The turn loads the active objective + its unfilled slots, applies the reasoning
 * component's slot updates under one invariant (`applySlotUpdates`), and on completion
 * pops the objective and activates the next.
 */
export class ObjectiveRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new ObjectiveRepository(db);
  }

  /**
   * Loads the thread's `active` objective and its **unfilled** slots (`status != 'filled'`),
   * for tight turn context. Read-only.
   * @returns The objective + its unfilled slots, or null when no objective is active.
   */
  async loadActive(threadId: string): Promise<{ objective: Objective; slots: Slot[] } | null> {
    const [row] = await this.db
      .select()
      .from(objectives)
      .where(and(eq(objectives.threadId, threadId), eq(objectives.status, 'active')));
    if (!row) return null;
    const objective = ObjectiveSchema.parse(row);

    const slotRows = await this.db
      .select()
      .from(slots)
      .where(and(eq(slots.objectiveId, objective.id), ne(slots.status, 'filled')));
    return { objective, slots: slotRows.map((s) => SlotSchema.parse(s)) };
  }

  /**
   * Inserts an objective plus its slot rows. A `top` push runs under the turn lock:
   * it demotes the current active first, then inserts `active` at `MAX(stack_position)+1`.
   * A `bottom` push is the lock-free background insert — `suspended` at `MIN-1`, no demotion.
   * An empty stack always yields an `active` objective at position 0.
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

    if (input.slots.length)
      await tx.insert(slots).values(
        input.slots.map((s) => ({
          objectiveId: objective.id,
          key: s.key,
          scope: s.scope,
          memberUserId: s.memberUserId ?? null,
          required: s.required,
          status: 'unasked' as const,
        })),
      );
    return objective;
  }

  /**
   * Applies the reasoning component's slot updates within the turn's transaction. The one
   * enforced invariant: a slot may become `filled` only with a value present — either
   * supplied in the update or already stored on the row. A value-less fill is rejected,
   * because the model can't claim progress the database doesn't hold.
   * @throws If an update sets `filled` with no effective value.
   */
  async applySlotUpdates(updates: SlotUpdate[], tx: Tx): Promise<void> {
    for (const update of updates) {
      if (update.status === 'filled' && !(await this.hasValue(update, tx)))
        throw new Error(`Cannot mark slot ${update.slotId} filled without a value`);
      const set = 'value' in update ? { status: update.status, value: update.value } : { status: update.status };
      await tx.update(slots).set(set).where(eq(slots.id, update.slotId));
    }
  }

  /** True when the update carries a non-null value, or the stored row already has one. */
  private async hasValue(update: SlotUpdate, tx: Tx): Promise<boolean> {
    if (update.value !== undefined && update.value !== null) return true;
    if (update.value === null) return false;
    const [row] = await tx.select({ value: slots.value }).from(slots).where(eq(slots.id, update.slotId));
    return row?.value !== undefined && row?.value !== null;
  }

  /**
   * Instantiates member-scoped slot rows for one identified member, idempotent on the unique
   * `(objective_id, key, member_user_id)` index — re-identifying a member is a no-op. Called by
   * the identity flow as each membership is created (AC-6), never as an atomic batch.
   */
  async instantiateMemberSlots(objectiveId: string, specs: SlotSpec[], tx: Tx): Promise<void> {
    if (!specs.length) return;
    await tx
      .insert(slots)
      .values(specs.map((s) => ({ objectiveId, key: s.key, scope: s.scope, memberUserId: s.memberUserId ?? null, required: s.required, status: 'unasked' as const })))
      .onConflictDoNothing({ target: [slots.objectiveId, slots.key, slots.memberUserId] });
  }

  /**
   * Marks one household-scoped slot `filled` with a value, resolving it by key on the objective.
   * Used by the identity flow to fill `household.same_household` once the household exists.
   */
  async markSlotFilled(objectiveId: string, key: string, value: unknown, tx: Tx): Promise<void> {
    await tx.update(slots).set({ status: 'filled', value }).where(and(eq(slots.objectiveId, objectiveId), eq(slots.key, key)));
  }

  /**
   * Marks the objective `complete` (with `completed_at`), then activates the
   * highest-`stack_position` `suspended` sibling on the same thread. Because the completed
   * row is no longer active, activating the next never trips the one-active index.
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
    await tx.update(objectives).set({ status: 'active' }).where(eq(objectives.id, next.id));
    return ObjectiveSchema.parse({ ...next, status: 'active' });
  }

  /**
   * True when the objective has zero required, non-terminal slots (`filled`/`defaulted` are
   * terminal). Optional slots never block completion. Read-only.
   */
  async isComplete(objectiveId: string, tx?: Tx): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .select({ open: sql<number>`count(*)` })
      .from(slots)
      .where(and(eq(slots.objectiveId, objectiveId), eq(slots.required, true), sql`${slots.status} not in ('filled','defaulted')`));
    return (row?.open ?? 0) === 0;
  }
}
