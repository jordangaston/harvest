import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit-test the workflow's logic in isolation (per the DBOS testing guide): the
// workflow + transaction decorators become no-ops so the static methods run as
// plain functions, and the status writes + pipeline are spied — no Postgres, no
// DBOS runtime.
vi.mock('@dbos-inc/dbos-sdk', () => {
  const passthrough = () => (_t: unknown, _k: unknown, descriptor: unknown) => descriptor;
  return { DBOS: { workflow: passthrough, step: passthrough, startWorkflow: vi.fn() } };
});

vi.mock('@dbos-inc/drizzle-datasource', () => {
  class DrizzleDataSource {
    transaction() {
      return (_t: unknown, _k: unknown, descriptor: unknown) => descriptor;
    }
    static get client() {
      return {};
    }
    static initializeDBOSSchema() {
      return Promise.resolve();
    }
  }
  return { DrizzleDataSource };
});

import { ImportWorkflow } from '../../src/pipeline/import-workflow.js';
import { ImportPipeline, ImportError } from '../../src/pipeline/import-pipeline.js';

const INPUT = { jobId: 'job-1', userId: 'user-1', sourceType: 'tiktok' as const, sourceRef: 'https://x' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ImportWorkflow, 'markRunning').mockResolvedValue();
  vi.spyOn(ImportWorkflow, 'markReady').mockResolvedValue();
  vi.spyOn(ImportWorkflow, 'markFailed').mockResolvedValue();
});

describe('ImportWorkflow — status transitions + exception handling only', () => {
  it('marks running, then ready with the recipe id when the pipeline succeeds', async () => {
    vi.spyOn(ImportPipeline, 'run').mockResolvedValue(['recipe-9']);
    await ImportWorkflow.run(INPUT);
    expect(ImportWorkflow.markRunning).toHaveBeenCalledWith('job-1');
    expect(ImportWorkflow.markReady).toHaveBeenCalledWith('job-1', ['recipe-9']);
    expect(ImportWorkflow.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed with the ImportError code when the pipeline throws one', async () => {
    vi.spyOn(ImportPipeline, 'run').mockRejectedValue(new ImportError('MEDIA_UNAVAILABLE'));
    await ImportWorkflow.run(INPUT);
    expect(ImportWorkflow.markRunning).toHaveBeenCalledWith('job-1');
    expect(ImportWorkflow.markFailed).toHaveBeenCalledWith('job-1', 'MEDIA_UNAVAILABLE');
    expect(ImportWorkflow.markReady).not.toHaveBeenCalled();
  });

  it('maps an unexpected throw to EXTRACTION_FAILED', async () => {
    vi.spyOn(ImportPipeline, 'run').mockRejectedValue(new Error('boom'));
    await ImportWorkflow.run(INPUT);
    expect(ImportWorkflow.markFailed).toHaveBeenCalledWith('job-1', 'EXTRACTION_FAILED');
  });
});
