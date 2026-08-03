import { and, eq, sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { importJobs } from '../db/schema/index.js';
import type { SourceType } from '../db/schema/enums.js';
import { ImportJobSchema, type ImportJob } from '../models/import-job.js';

/** A Drizzle client usable for a query: the db singleton or a transaction
 * client (the DBOS `appDataSource.client` inside a `runTransaction` body). */
export type DbExecutor = Pick<Database, 'select' | 'insert' | 'update'>;

/** Fields the intake supplies to create a queued job; the DB defaults the rest. */
export interface CreateImportJobInput {
  /** App-generated uuid used as both the row id and the DBOS workflow id, so
   * the insert and the enqueued workflow reference the same identifier. */
  id: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
}

/** The terminal outcome the workflow persists once parsing resolves (AC-6). */
export interface TerminalUpdate {
  status: 'ready' | 'failed';
  progress: number;
  errorCode?: string | null;
  recipeId?: string | null;
}

/**
 * Data access for `import_jobs`. The status/progress updaters take an optional
 * `tx` executor so the workflow can run each transition inside a DBOS
 * `runTransaction` (committing atomically with the checkpoint). Reads are
 * owner-scoped (`findByIdForUser`) so a job never leaks across users (AC-8).
 */
export class ImportJobRepository {
  constructor(private readonly db: Database) {}

  static create() {
    return new ImportJobRepository(db);
  }

  /** Inserts a `queued` job with a caller-supplied id and returns the row. */
  async create(input: CreateImportJobInput, tx?: DbExecutor): Promise<ImportJob> {
    const [row] = await this.exec(tx)
      .insert(importJobs)
      .values({ ...input, status: 'queued' })
      .returning();
    return ImportJobSchema.parse(row);
  }

  /** Finds a job by id, scoped to its owner — null if missing or foreign. */
  async findByIdForUser(id: string, userId: string, tx?: DbExecutor): Promise<ImportJob | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, id), eq(importJobs.userId, userId)));
    return row ? ImportJobSchema.parse(row) : null;
  }

  /** Transitions a job to `running` with the given progress; bumps updated_at. */
  async setRunning(id: string, progress: number, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(importJobs)
      .set({ status: 'running', progress, updatedAt: sql`now()` })
      .where(eq(importJobs.id, id));
  }

  /** Writes the terminal status (+ error code / recipe id) and bumps updated_at. */
  async setTerminal(id: string, update: TerminalUpdate, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(importJobs)
      .set({
        status: update.status,
        progress: update.progress,
        errorCode: update.errorCode ?? null,
        recipeId: update.recipeId ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(importJobs.id, id));
  }

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.db;
  }
}
