import { and, eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { importJobs, importJobRecipes, type SourceType } from '../schema.js';
import { ImportJobSchema, type ImportJob } from '../models/import-job.js';

/** A write executor: the db singleton, or a transaction client when a status
 * write must commit atomically with other rows (the workflow's persist step). */
export type DbExecutor = Pick<Database, 'update' | 'insert'>;

/** Fields the intake supplies to create a queued job; the DB defaults the rest. */
export interface CreateImportJobInput {
  /** App-generated uuid, used as both the row id and the workflow run id, so the
   * insert and the started workflow reference the same identifier. */
  id: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
}

/** The terminal outcome the workflow persists once parsing resolves. */
export interface TerminalUpdate {
  status: 'ready' | 'failed';
  progress: number;
  errorCode?: string | null;
  recipeId?: string | null;
}

/**
 * Data access for `import_jobs`. The workflow's status steps call these writes;
 * reads are owner-scoped (`findByIdForUser`) so a job never leaks across users.
 */
export class ImportJobRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new ImportJobRepository(db);
  }

  /**
   * Inserts a `queued` job with the caller-supplied id.
   * @param input - Intake fields; the DB defaults status/progress/timestamps.
   * @returns The inserted row, parsed into the domain model.
   */
  async create(input: CreateImportJobInput): Promise<ImportJob> {
    const [row] = await this.db.insert(importJobs).values({ ...input, status: 'queued' }).returning();
    return ImportJobSchema.parse(row);
  }

  /**
   * Finds a job by id, scoped to its owner so it never leaks across users.
   * @param id - Job id.
   * @param userId - Owner the job must belong to.
   * @returns The job parsed into the domain model, or null if missing or foreign.
   */
  async findByIdForUser(id: string, userId: string): Promise<ImportJob | null> {
    const [row] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, id), eq(importJobs.userId, userId)));
    return row ? ImportJobSchema.parse(row) : null;
  }

  /**
   * Transitions a job to `running` and bumps updated_at.
   * @param id - Job id.
   * @param progress - Progress value to record.
   * @param tx - Executor; a transaction client when the write must commit with
   *   other rows, else the db singleton.
   */
  async setRunning(id: string, progress: number, tx: DbExecutor = this.db): Promise<void> {
    // Delta (b): SQLite has no now() — stamp the timestamp in JS.
    await tx
      .update(importJobs)
      .set({ status: 'running', progress, updatedAt: new Date() })
      .where(eq(importJobs.id, id));
  }

  /**
   * Writes the terminal status (+ error code / recipe id) and bumps updated_at.
   * @param id - Job id.
   * @param update - Terminal outcome: `ready`/`failed`, progress, and either
   *   error code or recipe id (null-coalesced to null when absent).
   * @param tx - Executor; a transaction client to commit with other rows, else the db singleton.
   */
  async setTerminal(id: string, update: TerminalUpdate, tx: DbExecutor = this.db): Promise<void> {
    await tx
      .update(importJobs)
      .set({
        status: update.status,
        progress: update.progress,
        errorCode: update.errorCode ?? null,
        recipeId: update.recipeId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(importJobs.id, id));
  }

  /**
   * Records the recipes an import produced, in slide order (idempotent on the
   * (import_job_id, recipe_id) key, so a workflow re-run re-links safely).
   * @param jobId - The import job.
   * @param recipeIds - Persisted recipe ids, in the order to surface them.
   * @param tx - Executor; a transaction client to commit with other rows, else the db singleton.
   */
  async linkRecipes(jobId: string, recipeIds: string[], tx: DbExecutor = this.db): Promise<void> {
    if (recipeIds.length === 0) return;
    await tx
      .insert(importJobRecipes)
      .values(recipeIds.map((recipeId, position) => ({ importJobId: jobId, recipeId, position })))
      .onConflictDoNothing();
  }

  /** The owner of a job, or null if the id is unknown — a lean read for the completion
   *  notify, which knows only the job id. */
  async userIdById(jobId: string): Promise<string | null> {
    const [row] = await this.db.select({ userId: importJobs.userId }).from(importJobs).where(eq(importJobs.id, jobId));
    return row?.userId ?? null;
  }

  /**
   * Reads the recipe ids an import produced, in slide order.
   * @param jobId - The import job.
   * @returns The linked recipe ids ordered by position (empty until it's ready).
   */
  async findRecipeIds(jobId: string): Promise<string[]> {
    const rows = await this.db
      .select({ recipeId: importJobRecipes.recipeId })
      .from(importJobRecipes)
      .where(eq(importJobRecipes.importJobId, jobId))
      .orderBy(importJobRecipes.position);
    return rows.map((row) => row.recipeId);
  }
}
