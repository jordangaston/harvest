import { INBOUND_TOPIC, type Doorbell } from "../imessage/doorbell.js";
import type { CronJobsRepository } from "./cron-jobs-repository.js";
import { nextRun } from "./next-run.js";

/** Sends a doorbell to the inbound queue, keyed for idempotency. Matches `queue.send`'s
 *  shape so the deployed sweep passes the real client and a test passes a mock. */
export type SendDoorbell = (
  topic: string,
  payload: Doorbell,
  options: { idempotencyKey: string },
) => Promise<unknown>;

/**
 * One sweep: advance every due job to its next slot, then wake the thread.
 *
 * The advance is committed BEFORE the doorbell is enqueued — a crash between the two
 * loses one beat (self-heals next tick), where the reverse order would re-fire a
 * poisoned row forever. Both a `thread_heartbeat` and a `meal_reminder` row send a bare
 * `{threadId}` doorbell (deduped per slot by `<jobType-prefix>:<threadId>:<dueSlotISO>`);
 * the consumer makes every real decision later, under the thread lock. A reminder advances
 * in its household zone (`input.tz`), so an "18:00" holds at 6pm local through DST; a
 * heartbeat carries no tz and stays UTC.
 * @param repo - the dynamic-cron-jobs repository.
 * @param send - enqueues the doorbell (the queue client, or a test mock).
 * @param now - the sweep instant.
 * @returns how many doorbells were enqueued.
 */
export async function sweep(repo: CronJobsRepository, send: SendDoorbell, now: Date): Promise<number> {
  const due = await repo.loadDue(now);
  let dispatched = 0;
  for (const job of due) {
    const slot = job.nextRunAt.toISOString();
    const timezone = typeof job.input.tz === "string" ? job.input.tz : undefined;
    await repo.advance(job.id, nextRun(job.cronExpression, now, timezone));
    const threadId = String(job.input.threadId);
    const keyPrefix = job.jobType === "meal_reminder" ? `mr:${job.meal}` : "hb";
    await send(INBOUND_TOPIC, { threadId }, { idempotencyKey: `${keyPrefix}:${threadId}:${slot}` });
    dispatched++;
  }
  console.info(JSON.stringify({ event: "sweep completed", due: due.length, dispatched }));
  return dispatched;
}
