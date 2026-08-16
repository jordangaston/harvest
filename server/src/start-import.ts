import { start } from "workflow/api";
import { eq } from "drizzle-orm";
import { dbFromEnv } from "./edge-db.js";
import { importJobs } from "./schema.js";
import { importWorkflow } from "./workflows/import-workflow.js";
import type { ImportInput } from "./import-domain.js";

/**
 * Start the durable import workflow for one enqueued job, idempotently. WDK
 * generates its own run id (it has no caller-supplied run id), so idempotency is
 * enforced on the job row: a job is started only while it is still `queued`. A
 * queue redelivery (Queues is at-least-once) whose job has already advanced to
 * `running`/`ready`/`failed` is a successful no-op — not a duplicate import. This
 * pairs with the `idempotencyKey` on `send()`, which dedups redeliveries in the
 * retention window before they ever reach the consumer.
 *
 * @returns true if a workflow was started, false if the redelivery was a no-op.
 */
export async function startImport(msg: ImportInput): Promise<boolean> {
  const db = dbFromEnv();
  const [row] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, msg.jobId));
  if (!row || row.status !== "queued") return false;
  await start(importWorkflow, [msg]);
  return true;
}
