import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { eq, sql } from 'drizzle-orm';
import type { Client } from '@libsql/client';
import { schema, importJobs, importJobRecipes, recipes, ingredients, recipeSteps } from './schema.js';
import type { RecipeRow } from './mapping.js';
import type { ImportInput, ImportErrorCode, SourceType } from './domain.js';

export type Db = LibSQLDatabase<typeof schema>;

/**
 * Wrap a libSQL client in a Drizzle client. The caller supplies the client so the
 * client *build* stays at the edge: a Worker passes `@libsql/client/web` (HTTP,
 * no Node), a Node test passes `@libsql/client` with a `file:` URL. Both satisfy
 * the same `Client` interface, so this layer is build-agnostic.
 */
export function makeDb(client: Client): Db {
  return drizzle(client, { schema });
}

/**
 * libSQL (Turso) data access for the import path. Turso is SQLite over libSQL and
 * **supports interactive transactions**, so the Postgres `db.transaction()` shape
 * is restored — no D1 `db.batch()` workaround. Ids are still generated in app code
 * (SQLite has no `gen_random_uuid`), which keeps the workflow steps replay-safe.
 */
export class ImportStore {
  constructor(private readonly db: Db) {}
  static of(client: Client) {
    return new ImportStore(makeDb(client));
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
   * Persist a recipe and mark the job `ready` in ONE interactive transaction:
   * recipe → ingredients → steps → job-recipe link → job status. Either the whole
   * import lands or none of it does. This is the exact `RecipeRepository.persist`
   * shape from `server/src` — restored, because libSQL gives us real transactions
   * that D1 forced us to collapse into a batch.
   */
  async persistAndReady(row: RecipeRow, input: ImportInput): Promise<string> {
    const recipeId = crypto.randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(recipes).values({
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
      });
      if (row.ingredients.length) {
        await tx.insert(ingredients).values(
          row.ingredients.map((ing, i) => ({
            recipeId,
            position: i,
            name: ing.name,
            amount: ing.amount,
            unit: ing.unit,
            quantityText: ing.quantityText,
            icon: null,
          })),
        );
      }
      if (row.steps.length) {
        await tx.insert(recipeSteps).values(row.steps.map((text, i) => ({ recipeId, position: i, text })));
      }
      await tx.insert(importJobRecipes).values({ importJobId: input.jobId, recipeId, position: 0 });
      await tx
        .update(importJobs)
        .set({ status: 'ready', progress: 100, recipeId, updatedAt: new Date() })
        .where(eq(importJobs.id, input.jobId));
    });
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
   * error sees the incremented count, proving the surrounding durable state (and
   * the completed upstream steps) survived the failure.
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
