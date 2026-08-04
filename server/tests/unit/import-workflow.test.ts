import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit-test the workflow's logic in isolation (per the DBOS testing guide): the
// decorators become no-ops so the static methods run as plain functions, and the
// steps are spied — no Postgres, no DBOS runtime, no repository.
vi.mock('@dbos-inc/dbos-sdk', () => {
  const decorator = () => (_t: unknown, _k: unknown, descriptor: unknown) => descriptor;
  return { DBOS: { workflow: decorator, step: decorator, startWorkflow: vi.fn() } };
});

import { ImportWorkflow } from '../../src/pipeline/import-workflow.js';
import { ImportStatus } from '../../src/pipeline/import-status.js';
import { ImportPipeline, ImportError } from '../../src/pipeline/import-pipeline.js';

const INPUT = { jobId: 'job-1', userId: 'user-1', sourceType: 'tiktok' as const, sourceRef: 'https://x' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ImportStatus, 'markRunning').mockResolvedValue();
  vi.spyOn(ImportStatus, 'markReady').mockResolvedValue();
  vi.spyOn(ImportStatus, 'markFailed').mockResolvedValue();
});

describe('ImportWorkflow — status transitions + exception handling only', () => {
  it('marks running, then ready with the recipe id when the pipeline succeeds', async () => {
    vi.spyOn(ImportPipeline.prototype, 'run').mockResolvedValue('recipe-9');
    await ImportWorkflow.run(INPUT);
    expect(ImportStatus.markRunning).toHaveBeenCalledWith('job-1');
    expect(ImportStatus.markReady).toHaveBeenCalledWith('job-1', 'recipe-9');
    expect(ImportStatus.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed with the ImportError code when the pipeline throws one', async () => {
    vi.spyOn(ImportPipeline.prototype, 'run').mockRejectedValue(new ImportError('MEDIA_UNAVAILABLE'));
    await ImportWorkflow.run(INPUT);
    expect(ImportStatus.markRunning).toHaveBeenCalledWith('job-1');
    expect(ImportStatus.markFailed).toHaveBeenCalledWith('job-1', 'MEDIA_UNAVAILABLE');
    expect(ImportStatus.markReady).not.toHaveBeenCalled();
  });

  it('maps an unexpected throw to EXTRACTION_FAILED', async () => {
    vi.spyOn(ImportPipeline.prototype, 'run').mockRejectedValue(new Error('boom'));
    await ImportWorkflow.run(INPUT);
    expect(ImportStatus.markFailed).toHaveBeenCalledWith('job-1', 'EXTRACTION_FAILED');
  });
});
