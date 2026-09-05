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
 * One heartbeat sweep: advance every due job to its next slot, then wake the thread.
 *
 * The advance is committed BEFORE the doorbell is enqueued — a crash between the two
 * loses one beat (self-heals next tick), where the reverse order would re-fire a
 * poisoned row forever. A `thread_heartbeat` row sends a bare `{threadId}` doorbell,
 * deduped per slot by `hb:<threadId>:<dueSlotISO>`; the consumer makes every real
 * follow-up decision later, under the thread lock.
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
    await repo.advance(job.id, nextRun(job.cronExpression, now));
    if (job.jobType !== "thread_heartbeat") continue;
    const threadId = String(job.input.threadId);
    await send(INBOUND_TOPIC, { threadId }, { idempotencyKey: `hb:${threadId}:${slot}` });
    dispatched++;
  }
  console.info(JSON.stringify({ event: "sweep completed", due: due.length, dispatched }));
  return dispatched;
}
