import { DBOS } from '@dbos-inc/dbos-sdk';
import { ImportStatus } from './import-status.js';
import { ImportPipeline, ImportError, type ImportInput } from './import-pipeline.js';

/**
 * The durable import workflow. Its only job is to drive the job's status and
 * handle failure: mark it `running`, run the import pipeline (a separate
 * concern), then write the terminal status — `ready` + recipe on success, or
 * `failed` + error code if the pipeline throws. Each status write is a memoized
 * step, so a resume never repeats a completed transition.
 */
export class ImportWorkflow {
  @DBOS.workflow()
  static async run(input: ImportInput): Promise<void> {
    await ImportStatus.markRunning(input.jobId);
    try {
      const recipeId = await ImportPipeline.create().run(input);
      await ImportStatus.markReady(input.jobId, recipeId);
    } catch (err) {
      await ImportStatus.markFailed(input.jobId, ImportError.codeOf(err));
    }
  }
}

/** Enqueues the workflow under the job's id, so the durable run and the job row
 * share one identifier (idempotent: enqueuing the same id twice runs once). */
export async function startImportWorkflow(input: ImportInput): Promise<void> {
  await DBOS.startWorkflow(ImportWorkflow, { workflowID: input.jobId }).run(input);
}
