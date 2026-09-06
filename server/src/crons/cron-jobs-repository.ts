import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db.js";
import { dynamicCronJobs } from "../schema.js";
import { nextRun } from "./next-run.js";

/** A drizzle transaction client — the lifecycle writes commit inside the caller's objective txn. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The plain 5-minute default for a new heartbeat (DESIGN Q-02: quiet-hours expression deferred). */
const DEFAULT_HEARTBEAT_CRON = "*/5 * * * *";

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

  /**
   * Creates or resumes a thread's `thread_heartbeat` row (O-02 lifecycle): unpaused, with
   * `next_run_at` recomputed from the row's cron expression at `now`. An existing row keeps its
   * stored `cron_expression` (a custom per-thread cadence survives resume) — only `is_paused`,
   * `next_run_at`, `updated_at` change. Called inside the objective transaction when an objective
   * becomes active; the read-then-write is safe because activation runs under the per-thread lock.
   */
  async upsertHeartbeat(threadId: string, now: Date, tx: Tx): Promise<void> {
    const [existing] = await tx
      .select({ cronExpression: dynamicCronJobs.cronExpression })
      .from(dynamicCronJobs)
      .where(
        and(
          eq(dynamicCronJobs.ownerType, "thread"),
          eq(dynamicCronJobs.ownerId, threadId),
          eq(dynamicCronJobs.jobType, "thread_heartbeat"),
        ),
      );
    const cronExpression = existing?.cronExpression ?? DEFAULT_HEARTBEAT_CRON;
    await tx
      .insert(dynamicCronJobs)
      .values({
        jobType: "thread_heartbeat",
        ownerType: "thread",
        ownerId: threadId,
        input: { threadId },
        cronExpression,
        nextRunAt: nextRun(cronExpression, now),
        isPaused: false,
      })
      .onConflictDoUpdate({
        target: [dynamicCronJobs.ownerType, dynamicCronJobs.ownerId, dynamicCronJobs.jobType],
        set: { isPaused: false, nextRunAt: nextRun(cronExpression, now), updatedAt: now },
      });
  }

  /** Pauses a thread's `thread_heartbeat` row (O-02: the objective stack emptied). No-op if absent. */
  async pause(threadId: string, tx: Tx): Promise<void> {
    await tx
      .update(dynamicCronJobs)
      .set({ isPaused: true, updatedAt: new Date() })
      .where(
        and(
          eq(dynamicCronJobs.ownerType, "thread"),
          eq(dynamicCronJobs.ownerId, threadId),
          eq(dynamicCronJobs.jobType, "thread_heartbeat"),
        ),
      );
  }
}
