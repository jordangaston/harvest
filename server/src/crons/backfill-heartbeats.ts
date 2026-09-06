import { and, eq } from "drizzle-orm";
import type { Database } from "../db.js";
import { dynamicCronJobs, objectives } from "../schema.js";
import { CronJobsRepository } from "./cron-jobs-repository.js";

/**
 * One-off backfill for the O-02 heartbeat lifecycle: gives every thread that already has an active
 * objective a live `thread_heartbeat` row, matching what the lifecycle hooks would have created had
 * they existed when the objective activated.
 *
 * Idempotent — for each such thread it upserts only when the row is absent or paused; a row that is
 * already present and unpaused is left untouched, so a re-run changes nothing. Threads without an
 * active objective get no row. Returns per-outcome counts.
 * @param db - the target database.
 * @param now - the instant to compute each new row's `next_run_at` from.
 */
export async function backfillHeartbeats(
  db: Database,
  now = new Date(),
): Promise<{ created: number; resumed: number; skipped: number }> {
  const activeThreads = await db
    .selectDistinct({ threadId: objectives.threadId })
    .from(objectives)
    .where(eq(objectives.status, "active"));

  const heartbeats = CronJobsRepository.create(db);
  let created = 0;
  let resumed = 0;
  let skipped = 0;

  for (const { threadId } of activeThreads) {
    const [row] = await db
      .select({ isPaused: dynamicCronJobs.isPaused })
      .from(dynamicCronJobs)
      .where(
        and(
          eq(dynamicCronJobs.ownerType, "thread"),
          eq(dynamicCronJobs.ownerId, threadId),
          eq(dynamicCronJobs.jobType, "thread_heartbeat"),
        ),
      );

    if (row && !row.isPaused) {
      skipped++;
      continue;
    }
    await db.transaction((tx) => heartbeats.upsertHeartbeat(threadId, now, tx));
    if (row) resumed++;
    else created++;
  }

  return { created, resumed, skipped };
}
