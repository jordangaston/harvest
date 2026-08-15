import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { schema, importJobs, importJobRecipes, recipes, ingredients, recipeSteps } from './schema.js';
import type { RecipeRow } from './mapping.js';
import type { ImportInput, ImportErrorCode, SourceType } from './domain.js';

export type Db = DrizzleD1Database<typeof schema>;

/** Wrap a D1 binding in a Drizzle client (per-invocation — no long-lived pool). */
export function makeDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/**
 * D1 data access for the import path. Postgres's cross-table transaction
 * (`db.transaction`) is NOT available on D1 — its atomic primitive is
 * `db.batch([...])`, which runs the statements as one SQL transaction and rolls
 * back on any failure. Ids are generated in app code (SQLite has no
 * `gen_random_uuid` and D1 has no `RETURNING`-into-a-transaction pattern), which
 * also lets a batch reference the new recipe id across statements.
 */
export class ImportStore {
  constructor(private readonly db: Db) {}
  static of(d1: D1Database) {
    return new ImportStore(makeDb(d1));
  }

  /** Create a user (the import's owner). Returns the new id. */
  async createUser(phone: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.insert(schema.users).values({ id, phone });
    return id;
  }

  /** Write one `queued` import job under a caller-supplied id. */
  async createJob(input: { id: string; userId: string; sourceType: SourceType; sourceRef: string }): Promise<void> {
    await this.db.insert(importJobs).values({ ...input, status: 'queued', progress: 0 });
  }

  /** Flip the job to `running` (idempotent — a Workflow step may replay). */
  async setRunning(jobId: string): Promise<void> {
    await this.db.update(importJobs).set({ status: 'running', progress: 10, updatedAt: new Date() }).where(eq(importJobs.id, jobId));
  }

  /**
   * Persist a recipe and mark the job `ready` in ONE atomic D1 batch: recipe →
   * ingredients → steps → job-recipe link → job status. Either the whole import
   * lands or none of it does. Mirrors RecipeRepository.persist + markReady,
   * collapsed into a single batch because D1 has no interactive transaction.
   */
  async persistAndReady(row: RecipeRow, input: ImportInput): Promise<string> {
    const recipeId = crypto.randomUUID();
    await this.db.batch([
      this.db.insert(recipes).values({
        id: recipeId,
        userId: input.userId,
        title: row.title,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
        servings: row.servings,
        servingsEstimated: row.servingsEstimated,
        totalMinutes: row.totalMinutes,
        imageUrl: row.imageUrl,
        confidence: row.confidence,
      }),
      ...row.ingredients.map((ing, i) =>
        this.db.insert(ingredients).values({
          recipeId,
          position: i,
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          quantityText: ing.quantityText,
          icon: null,
        }),
      ),
      ...row.steps.map((text, i) => this.db.insert(recipeSteps).values({ recipeId, position: i, text })),
      this.db.insert(importJobRecipes).values({ importJobId: input.jobId, recipeId, position: 0 }),
      this.db
        .update(importJobs)
        .set({ status: 'ready', progress: 100, recipeId, updatedAt: new Date() })
        .where(eq(importJobs.id, input.jobId)),
    ]);
    return recipeId;
  }

  /** Flip the job to `failed` with a machine error code. */
  async setFailed(jobId: string, errorCode: ImportErrorCode): Promise<void> {
    await this.db
      .update(importJobs)
      .set({ status: 'failed', progress: 100, errorCode, updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
  }

  /**
   * Increment the job's fault counter and return the NEW value. The proof's
   * recovery marker: a Workflow step calls this on entry; a retry after a thrown
   * error sees the incremented count in D1 and stops faulting — proving the
   * step's side effects and the surrounding durable state survive the failure.
   */
  async bumpFaultAttempts(jobId: string): Promise<number> {
    const [row] = await this.db
      .update(importJobs)
      .set({ faultAttempts: sql`${importJobs.faultAttempts} + 1` })
      .where(eq(importJobs.id, jobId))
      .returning({ n: importJobs.faultAttempts });
    return row?.n ?? 0;
  }

  /** The job's public projection for polling. */
  async getJob(jobId: string) {
    const [row] = await this.db.select().from(importJobs).where(eq(importJobs.id, jobId));
    return row ?? null;
  }
}
