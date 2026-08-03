import { randomUUID } from 'node:crypto';
import { ImportJobRepository } from '../repositories/import-job-repository.js';
import { resolveSource, type SourceInput } from '../util/resolve-source.js';
import { toPublicJob, type PublicJob } from '../models/import-job.js';
import { startImportWorkflow, type ImportWorkflowInput } from '../pipeline/import-workflow.js';
import { NotFoundError, UnsupportedSourceError } from '../api/errors.js';

/** Enqueues the durable import workflow for a queued job. Injected so unit
 * tests pass a spy instead of touching DBOS. */
export type EnqueueImport = (input: ImportWorkflowInput) => Promise<void>;

/**
 * Orchestrates import intake (F-03) and polling (F-06). `create` resolves the
 * source (O-01), rejecting an unsupported one with a 422 *before* any write
 * (AC-4), then inserts a `queued` row with an app-generated uuid and enqueues
 * the workflow under that same id. `get` is owner-scoped and 404s a
 * missing-or-foreign id (AC-8). The workflow itself drives running→terminal.
 */
export class ImportService {
  constructor(
    private readonly jobs: ImportJobRepository,
    private readonly enqueue: EnqueueImport,
  ) {}

  static create() {
    return new ImportService(ImportJobRepository.create(), startImportWorkflow);
  }

  /**
   * Resolves + creates a queued import and enqueues its workflow.
   *
   * @param userId The authenticated caller who owns the job.
   * @param source Exactly one of `url`, `sharePayload`, or `imageRef`.
   * @returns The public queued job.
   * @throws {UnsupportedSourceError} If the source resolves to `unsupported`
   *   (422, before any row is written).
   */
  async create(userId: string, source: SourceInput): Promise<PublicJob> {
    const resolved = resolveSource(source);
    const sourceRef = resolved.normalizedUrl ?? resolved.imageRef;
    if (resolved.platform === 'unsupported' || !resolved.sourceType || !sourceRef) {
      throw new UnsupportedSourceError();
    }

    const jobId = randomUUID();
    const job = await this.jobs.create({ id: jobId, userId, sourceType: resolved.sourceType, sourceRef });
    // App-DB insert and system-DB enqueue live in separate databases, so this is
    // insert-then-enqueue; the workflow is idempotent (deterministic workflowID),
    // so a failed enqueue leaves a recoverable queued row, never an orphan run.
    await this.enqueue({ jobId, userId, sourceType: resolved.sourceType, sourceRef });
    return toPublicJob(job);
  }

  /**
   * Returns the caller's job for polling (F-06).
   *
   * @throws {NotFoundError} If the id is missing or owned by another user (404,
   *   no cross-user existence leak).
   */
  async get(userId: string, jobId: string): Promise<PublicJob> {
    const job = await this.jobs.findByIdForUser(jobId, userId);
    if (!job) throw new NotFoundError();
    return toPublicJob(job);
  }
}
