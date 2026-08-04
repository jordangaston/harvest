import { and, eq, sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';
import { importJobs } from '../db/schema/index.js';
import type { SourceType } from '../db/schema/enums.js';
import { ImportJobSchema, type ImportJob } from '../models/import-job.js';

/** A Drizzle client for a write: the db singleton, or the transaction client
 * (`DrizzleDataSource.client`) when a status write runs inside a DBOS transaction. */
export type DbExecutor = Pick<Database, 'update'>;

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
 * Data access for `import_jobs`. The workflow's status steps call these writes
 * directly (each step is DBOS-memoized, so a write lands at most once). Reads
 * are owner-scoped (`findByIdForUser`) so a job never leaks across users (AC-8).
 */
export class ImportJobRepository {
  constructor(private readonly db: Database) {}

  static create() {
    return new ImportJobRepository(db);
  }

  /** Inserts a `queued` job with a caller-supplied id and returns the row. */
  async create(input: CreateImportJobInput): Promise<ImportJob> {
    const [row] = await this.db.insert(importJobs).values({ ...input, status: 'queued' }).returning();
    return ImportJobSchema.parse(row);
  }

  /** Finds a job by id, scoped to its owner — null if missing or foreign. */
  async findByIdForUser(id: string, userId: string): Promise<ImportJob | null> {
    const [row] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, id), eq(importJobs.userId, userId)));
    return row ? ImportJobSchema.parse(row) : null;
  }

  /** Transitions a job to `running`; runs on `tx` when the workflow supplies its
   * transaction client, else the db singleton. */
  async setRunning(id: string, progress: number, tx: DbExecutor = this.db): Promise<void> {
    await tx
      .update(importJobs)
      .set({ status: 'running', progress, updatedAt: sql`now()` })
      .where(eq(importJobs.id, id));
  }

  /** Writes the terminal status (+ error code / recipe id) and bumps updated_at. */
  async setTerminal(id: string, update: TerminalUpdate, tx: DbExecutor = this.db): Promise<void> {
    await tx
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
}
