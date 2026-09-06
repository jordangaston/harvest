import { and, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { dynamicCronJobs, threads } from '../schema.js';
import { nextRun } from '../crons/next-run.js';
import type { MealSlot } from '../models/meal-plan.js';

/** A drizzle transaction client — a provisioning write can commit inside the caller's txn. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** A write executor: the db singleton (a tool write) or an interactive txn (a provisioning write). */
type Executor = Database | Tx;

/** The job type every meal-reminder row carries. */
export const MEAL_REMINDER = 'meal_reminder' as const;

/** A due reminder the consumer's fire arm reads: which thread + course to announce today, in which
 *  zone (so "today" and the per-day guid resolve in the household's local date). */
export const DueReminderSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string(),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  tz: z.string(),
});

export type DueReminder = z.infer<typeof DueReminderSchema>;

/**
 * Data access for `meal_reminder` rows — a view over `dynamic_cron_jobs` scoped to
 * `job_type = 'meal_reminder'`. Provisioning upserts one recurring row per course; the consumer's
 * fire arm loads the due ones under the thread lock. Pausing/recompute/tools land in WI-02/WI-03.
 */
export class ReminderRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new ReminderRepository(db);
  }

  /**
   * Creates or re-asserts a thread's reminder row for one course (F-01 provisioning). Idempotent on
   * the owner unique index `(owner_type, owner_id, job_type, meal)` — a re-run overwrites the cron,
   * next-run, tz, and pause with the freshly-derived values. `input` carries `{ threadId, meal, tz }`
   * so the sweep advances the row in its household zone without a join.
   * @param threadId - the thread the reminder belongs to.
   * @param meal - the course.
   * @param cronExpression - the daily local-time cron (course anchor − lead).
   * @param nextRunAt - the next fire instant (already resolved in the household zone).
   * @param isPaused - derived from the household's weekly count for the course (0 ⇒ paused).
   * @param tz - the IANA zone the cron is read in.
   */
  async upsertCourseReminder(
    threadId: string,
    meal: MealSlot,
    cronExpression: string,
    nextRunAt: Date,
    isPaused: boolean,
    tz: string,
    tx: Executor = this.db,
  ): Promise<void> {
    await tx
      .insert(dynamicCronJobs)
      .values({
        jobType: MEAL_REMINDER,
        ownerType: 'thread',
        ownerId: threadId,
        meal,
        input: { threadId, meal, tz },
        cronExpression,
        nextRunAt,
        isPaused,
      })
      .onConflictDoUpdate({
        target: [dynamicCronJobs.ownerType, dynamicCronJobs.ownerId, dynamicCronJobs.jobType, dynamicCronJobs.meal],
        set: { cronExpression, nextRunAt, isPaused, input: { threadId, meal, tz }, updatedAt: new Date() },
      });
  }

  /**
   * Re-derives every reminder row of a household's thread(s) into `tz` (F-04). The cron string is
   * unchanged — it encodes a local wall-clock the household keeps — but `input.tz` and the absolute
   * `next_run_at` move so the same wall-clock fires at the new zone's instant. Resolves household →
   * thread by the join `dynamic_cron_jobs.owner_id = threads.id WHERE threads.household_id = ?`
   * (DESIGN F-05: no new ThreadRepository method). A household with no reminders is a no-op.
   * @param householdId - the household whose timezone changed.
   * @param tz - the new IANA zone.
   * @param now - the instant next-run is computed from.
   */
  async recompute(householdId: string, tz: string, now: Date): Promise<void> {
    const rows = await this.householdReminders(householdId);
    for (const row of rows) {
      await this.db
        .update(dynamicCronJobs)
        .set({ input: { ...row.input, tz }, nextRunAt: nextRun(row.cronExpression, now, tz), updatedAt: new Date() })
        .where(eq(dynamicCronJobs.id, row.id));
    }
  }

  /**
   * Syncs one course's pause state to a household's weekly meal count (F-05). The rule is
   * `is_paused = count === 0 || pausedByUser`, where `pausedByUser` is the row's OWN stored marker
   * OR'd with any incoming one — so a course the household explicitly turned off (F-06) survives a
   * later count bump (raising the count can't resurrect it). Same household → thread join as
   * `recompute`. Reads `input.pausedByUser` per row so the precedence lives with the data, not the
   * caller.
   * @param householdId - the household whose meal count changed.
   * @param meal - the course.
   * @param count - the new weekly count for the course.
   * @param incomingPausedByUser - a `pausedByUser` flag carried on the fact's input (WI-03); OR'd
   *   with the row's stored marker so neither source can clear the other's explicit pause.
   */
  async setPausedByHousehold(householdId: string, meal: MealSlot, count: number, incomingPausedByUser: boolean): Promise<void> {
    const rows = (await this.householdReminders(householdId)).filter((r) => r.meal === meal);
    for (const row of rows) {
      const pausedByUser = incomingPausedByUser || row.input.pausedByUser === true;
      await this.db
        .update(dynamicCronJobs)
        .set({ isPaused: count === 0 || pausedByUser, input: { ...row.input, pausedByUser }, updatedAt: new Date() })
        .where(eq(dynamicCronJobs.id, row.id));
    }
  }

  /**
   * One thread's reminder row for a course, or null — the tools read it to branch on presence
   * (set_reminder_time upserts a missing course; set_reminder_enabled no-ops one). Returns the row's
   * `cron_expression` and stored `input` so a caller can preserve the tuned time / read `pausedByUser`.
   */
  async findCourseReminder(threadId: string, meal: MealSlot): Promise<{ cronExpression: string; input: Record<string, unknown> } | null> {
    const [row] = await this.db
      .select({ cronExpression: dynamicCronJobs.cronExpression, input: dynamicCronJobs.input })
      .from(dynamicCronJobs)
      .where(and(eq(dynamicCronJobs.jobType, MEAL_REMINDER), eq(dynamicCronJobs.ownerType, 'thread'), eq(dynamicCronJobs.ownerId, threadId), eq(dynamicCronJobs.meal, meal)));
    return row ?? null;
  }

  /**
   * Sets one course row's explicit pause marker and re-derives `is_paused` (F-06). `enabled=false`
   * sets `input.pausedByUser=true` + `is_paused=true`; `enabled=true` clears the marker and derives
   * `is_paused = weeklyCount === 0` (0 stays paused). The caller resolves the weekly count.
   * @param threadId - the thread whose course toggles.
   * @param meal - the course.
   * @param enabled - the requested state.
   * @param weeklyCount - the household's weekly count for the course, deriving the enabled pause.
   */
  async setEnabled(threadId: string, meal: MealSlot, enabled: boolean, weeklyCount: number): Promise<void> {
    const row = await this.findCourseReminder(threadId, meal);
    if (!row) return; // the tool guards this; a missing row is a no-op here.
    const pausedByUser = !enabled;
    const isPaused = !enabled || weeklyCount === 0;
    await this.db
      .update(dynamicCronJobs)
      .set({ isPaused, input: { ...row.input, pausedByUser }, updatedAt: new Date() })
      .where(and(eq(dynamicCronJobs.jobType, MEAL_REMINDER), eq(dynamicCronJobs.ownerType, 'thread'), eq(dynamicCronJobs.ownerId, threadId), eq(dynamicCronJobs.meal, meal)));
  }

  /** A household's reminder rows via the F-05 join — the shared resolution both writers key off. */
  private async householdReminders(householdId: string) {
    return this.db
      .select({ id: dynamicCronJobs.id, meal: dynamicCronJobs.meal, cronExpression: dynamicCronJobs.cronExpression, input: dynamicCronJobs.input })
      .from(dynamicCronJobs)
      .innerJoin(threads, eq(dynamicCronJobs.ownerId, threads.id))
      .where(and(eq(dynamicCronJobs.jobType, MEAL_REMINDER), eq(threads.householdId, householdId)));
  }

  /**
   * A thread's due, unpaused reminder rows at `now` — the consumer's fire arm reads today's plan for
   * each. Filters on the same `(is_paused, next_run_at)` index the sweep uses; a paused course never
   * surfaces. Read-only.
   */
  async loadDueReminders(threadId: string, now: Date): Promise<DueReminder[]> {
    const rows = await this.db
      .select({ id: dynamicCronJobs.id, ownerId: dynamicCronJobs.ownerId, meal: dynamicCronJobs.meal, input: dynamicCronJobs.input })
      .from(dynamicCronJobs)
      .where(
        and(
          eq(dynamicCronJobs.jobType, MEAL_REMINDER),
          eq(dynamicCronJobs.ownerType, 'thread'),
          eq(dynamicCronJobs.ownerId, threadId),
          eq(dynamicCronJobs.isPaused, false),
          lte(dynamicCronJobs.nextRunAt, now),
        ),
      );
    return rows.map((r) =>
      DueReminderSchema.parse({ id: r.id, threadId: r.ownerId, meal: r.meal, tz: typeof r.input.tz === 'string' ? r.input.tz : 'UTC' }),
    );
  }
}
