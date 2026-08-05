import { randomUUID } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { ImportJobRepository } from '../repositories/import-job-repository.js';
import { classifySource, type SourceInput } from '../util/detect-source.js';
import { toPublicJob, type PublicJob } from '../models/import-job.js';
import { ImportWorkflow } from '../pipeline/import-workflow.js';
import type { ImportInput } from '../pipeline/import-pipeline.js';
import { NotFoundError, UnsupportedSourceError } from '../api/errors.js';
import type { SourceType } from '../db/schema/enums.js';

/** Enqueues the durable import workflow. Injected so unit tests pass a spy
 * instead of touching DBOS. */
export type EnqueueImport = (input: ImportInput) => Promise<void>;

/**
 * Import intake (F-03) and polling (F-06). Each `createFrom*` classifies its
 * input, writes one `queued` row, and enqueues the workflow under the same id;
 * the workflow drives it onward. `get` is owner-scoped and 404s a
 * missing-or-foreign id.
 */
export class ImportService {
  constructor(
    private readonly jobs: ImportJobRepository,
    private readonly enqueue: EnqueueImport,
  ) {}

  /** Wire dependencies from the shared singletons. */
  static create() {
    // Enqueue the workflow under the job's id, so the durable run and the row
    // share one identifier (idempotent: enqueuing the same id twice runs once).
    return new ImportService(ImportJobRepository.create(), async (input) => {
      await DBOS.startWorkflow(ImportWorkflow, { workflowID: input.jobId }).run(input);
    });
  }

  /**
   * Creates a queued import from a submitted source (link or photo).
   *
   * @param userId - Owner of the new job.
   * @param source - The submitted link or photo to classify.
   * @returns The queued job for polling.
   * @throws {UnsupportedSourceError} If the source isn't importable (422).
   */
  async create(userId: string, source: SourceInput): Promise<PublicJob> {
    const classified = classifySource(source);
    if (!classified) throw new UnsupportedSourceError();
    return this.start(userId, classified.sourceType, classified.ref);
  }

  /**
   * Returns the caller's job for polling (F-06).
   *
   * @param userId - Caller; scopes the lookup so foreign ids 404.
   * @param jobId - The job to fetch.
   * @returns The job's public projection.
   * @throws {NotFoundError} If the id is missing or owned by another user (404).
   */
  async get(userId: string, jobId: string): Promise<PublicJob> {
    const job = await this.jobs.findByIdForUser(jobId, userId);
    if (!job) throw new NotFoundError();
    return toPublicJob(job, await this.jobs.findRecipeIds(jobId));
  }

  /**
   * Writes one `queued` row then enqueues the workflow under the same id.
   *
   * @param userId - Owner of the job.
   * @param sourceType - Classified source kind.
   * @param sourceRef - Classified source reference (url or upload id).
   * @returns The queued job.
   */
  private async start(userId: string, sourceType: SourceType, sourceRef: string): Promise<PublicJob> {
    const jobId = randomUUID();
    const job = await this.jobs.create({ id: jobId, userId, sourceType, sourceRef });
    // App-DB insert and system-DB enqueue live in separate databases, so this is
    // insert-then-enqueue; the workflow id equals the row id, so a failed enqueue
    // leaves a recoverable queued row, never an orphan run.
    await this.enqueue({ jobId, userId, sourceType, sourceRef });
    return toPublicJob(job);
  }
}
