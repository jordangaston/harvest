import { randomUUID } from "node:crypto";
import { dbFromEnv } from "./edge-db.js";
import { ImportJobRepository } from "./repositories/import-job-repository.js";
import { classifySource, type SourceInput } from "./classify.js";
import { toPublicJob, type PublicJob } from "./models/import-job.js";
import { send } from "./queue.js";
import type { ImportInput } from "./import-domain.js";

/** The intake topic every workflow start passes through — the single choke point. */
export const IMPORT_TOPIC = "import-intake";

/**
 * Import intake and polling, ported from server/src/services/import-service.ts.
 * `create` classifies the source, writes one `queued` row, then enqueues the
 * workflow input under the same job id and returns immediately (202). The queue
 * consumer starts the durable workflow. `get` is owner-scoped and 404s a
 * missing-or-foreign id.
 */
export class ImportService {
  /**
   * Create a queued import from a submitted source (link or photo).
   * @returns The queued job, or null when the source isn't importable (→ 422).
   */
  async create(userId: string, source: SourceInput, faultStep?: "extract"): Promise<PublicJob | null> {
    const classified = classifySource(source);
    if (!classified) return null;
    const jobId = randomUUID();
    const jobs = ImportJobRepository.create(dbFromEnv());
    const job = await jobs.create({ id: jobId, userId, sourceType: classified.sourceType, sourceRef: classified.ref });
    // Insert-then-enqueue: the app DB row and the queue live apart, and the job id
    // is the correlation key, so a failed enqueue leaves a recoverable queued row.
    // The idempotencyKey dedups a double intake within the retention window.
    const message: ImportInput = { jobId, userId, sourceType: classified.sourceType, sourceRef: classified.ref, faultStep };
    await send(IMPORT_TOPIC, message, { idempotencyKey: jobId });
    return toPublicJob(job);
  }

  /**
   * The caller's job for polling.
   * @returns The job's public projection, or null if missing/foreign (→ 404).
   */
  async get(userId: string, jobId: string): Promise<PublicJob | null> {
    const jobs = ImportJobRepository.create(dbFromEnv());
    const job = await jobs.findByIdForUser(jobId, userId);
    if (!job) return null;
    return toPublicJob(job, await jobs.findRecipeIds(jobId));
  }
}
