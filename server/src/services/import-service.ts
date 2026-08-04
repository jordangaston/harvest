import { randomUUID } from 'node:crypto';
import { ImportJobRepository } from '../repositories/import-job-repository.js';
import { detectSource, normalizeUrl } from '../util/detect-source.js';
import { toPublicJob, type PublicJob } from '../models/import-job.js';
import { startImportWorkflow } from '../pipeline/import-workflow.js';
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

  static create() {
    return new ImportService(ImportJobRepository.create(), startImportWorkflow);
  }

  /**
   * Creates a queued import from a link.
   *
   * @throws {UnsupportedSourceError} If the URL isn't an importable source (422).
   */
  async createFromUrl(userId: string, rawUrl: string | undefined): Promise<PublicJob> {
    const source = detectSource(rawUrl);
    if (!source) throw new UnsupportedSourceError();
    return this.start(userId, source, normalizeUrl(rawUrl!));
  }

  /** Creates a queued import from an uploaded photo's storage ref. */
  createFromPhoto(userId: string, imageRef: string): Promise<PublicJob> {
    return this.start(userId, 'photo', imageRef);
  }

  /**
   * Returns the caller's job for polling (F-06).
   *
   * @throws {NotFoundError} If the id is missing or owned by another user (404).
   */
  async get(userId: string, jobId: string): Promise<PublicJob> {
    const job = await this.jobs.findByIdForUser(jobId, userId);
    if (!job) throw new NotFoundError();
    return toPublicJob(job);
  }

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
