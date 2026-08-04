import { DBOS } from '@dbos-inc/dbos-sdk';
import { ImportJobRepository } from '../repositories/import-job-repository.js';

const repo = ImportJobRepository.create();

/**
 * The job's status transitions — the workflow's only side effect. Each is a
 * durable DBOS step, so a completed transition is memoized and skipped on
 * replay (idempotent even though the write and the checkpoint are in separate
 * databases). The workflow unit test mocks this class.
 */
export class ImportStatus {
  @DBOS.step()
  static async markRunning(jobId: string): Promise<void> {
    await repo.setRunning(jobId, 10);
  }

  @DBOS.step()
  static async markReady(jobId: string, recipeId: string): Promise<void> {
    await repo.setTerminal(jobId, { status: 'ready', progress: 100, recipeId });
  }

  @DBOS.step()
  static async markFailed(jobId: string, errorCode: string): Promise<void> {
    await repo.setTerminal(jobId, { status: 'failed', progress: 100, errorCode });
  }
}
