import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db.js";
import { dynamicCronJobs } from "../schema.js";

/** A due job the sweeper dispatches. Only the fields the sweep reads are modelled.
 *  `nextRunAt` is the slot the row is due for — the idempotency key that dedupes a
 *  re-swept slot (`hb:<threadId>:<nextRunAt ISO>`). */
export const DueCronJobSchema = z.object({
  id: z.string().uuid(),
  jobType: z.string(),
  input: z.record(z.string(), z.unknown()),
  cronExpression: z.string(),
  nextRunAt: z.date(),
});

export type DueCronJob = z.infer<typeof DueCronJobSchema>;

/**
 * Data access for `dynamic_cron_jobs` — the heartbeat timer table. The sweep
 * (`GET /crons/dispatch`) is its only caller today: load the due rows, advance each.
 */
export class CronJobsRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new CronJobsRepository(db);
  }

  /**
   * The unpaused jobs whose `next_run_at` has arrived, oldest-due first.
   * @param now - the sweep instant; rows with `next_run_at <= now` are due.
   */
  async loadDue(now: Date): Promise<DueCronJob[]> {
    const rows = await this.db
      .select({
        id: dynamicCronJobs.id,
        jobType: dynamicCronJobs.jobType,
        input: dynamicCronJobs.input,
        cronExpression: dynamicCronJobs.cronExpression,
        nextRunAt: dynamicCronJobs.nextRunAt,
      })
      .from(dynamicCronJobs)
      .where(and(eq(dynamicCronJobs.isPaused, false), lte(dynamicCronJobs.nextRunAt, now)))
      .orderBy(dynamicCronJobs.nextRunAt);
    return rows.map((row) => DueCronJobSchema.parse(row));
  }

  /** Sets a job's next fire time and bumps `updated_at`. */
  async advance(id: string, nextRunAt: Date): Promise<void> {
    await this.db
      .update(dynamicCronJobs)
      .set({ nextRunAt, updatedAt: new Date() })
      .where(eq(dynamicCronJobs.id, id));
  }
}
