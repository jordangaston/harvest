import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import { appDataSource } from './bootstrap.js';
import { ImportJobRepository, type DbExecutor } from '../repositories/import-job-repository.js';
import { ImportPipeline, ImportError, type ImportInput } from './import-pipeline.js';

const repo = ImportJobRepository.create();

/**
 * The durable import workflow. Its only job is to drive the job's status and
 * handle failure: mark it `running`, run the import pipeline (a separate
 * concern), then write the terminal status — `ready` + recipe, or `failed` +
 * error code if the pipeline throws.
 *
 * Each status write is a `@appDataSource.transaction`, so the `import_jobs` row
 * and the DBOS checkpoint commit together and can never diverge on a crash.
 */
export class ImportWorkflow {
  /**
   * Mark the job running, run the pipeline, then write the terminal status —
   * `ready` on success, `failed` + code if the pipeline throws. Never throws;
   * every outcome is a recorded status.
   * @param input - The job id, owner, and resolved source.
   */
  @DBOS.workflow()
  static async run(input: ImportInput): Promise<void> {
    await ImportWorkflow.markRunning(input.jobId);
    try {
      const recipeId = await ImportPipeline.run(input);
      await ImportWorkflow.markReady(input.jobId, recipeId);
    } catch (err) {
      await ImportWorkflow.markFailed(input.jobId, ImportError.codeOf(err));
    }
  }

  /**
   * Flip the job to `running` (commits with the DBOS checkpoint).
   * @param jobId - The job to update.
   */
  @appDataSource.transaction()
  static async markRunning(jobId: string): Promise<void> {
    await repo.setRunning(jobId, 10, DrizzleDataSource.client as unknown as DbExecutor);
  }

  /**
   * Flip the job to `ready` and attach its recipe.
   * @param jobId - The job to update.
   * @param recipeId - The persisted recipe.
   */
  @appDataSource.transaction()
  static async markReady(jobId: string, recipeId: string): Promise<void> {
    await repo.setTerminal(jobId, { status: 'ready', progress: 100, recipeId }, DrizzleDataSource.client as unknown as DbExecutor);
  }

  /**
   * Flip the job to `failed` and record why.
   * @param jobId - The job to update.
   * @param errorCode - The machine error code.
   */
  @appDataSource.transaction()
  static async markFailed(jobId: string, errorCode: string): Promise<void> {
    await repo.setTerminal(
      jobId,
      { status: 'failed', progress: 100, errorCode },
      DrizzleDataSource.client as unknown as DbExecutor,
    );
  }
}
