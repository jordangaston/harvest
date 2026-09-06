import { and, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { dynamicCronJobs } from '../schema.js';
import type { MealSlot } from '../models/meal-plan.js';

/** A drizzle transaction client — a provisioning write can commit inside the caller's txn. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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
    tx: Tx,
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
