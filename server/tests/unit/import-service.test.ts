import { describe, it, expect, vi } from 'vitest';
import { ImportService, type EnqueueImport } from '../../src/services/import-service.js';
import { ImportJobRepository } from '../../src/repositories/import-job-repository.js';
import { UnsupportedSourceError, NotFoundError } from '../../src/api/errors.js';
import type { ImportJob } from '../../src/models/import-job.js';

const USER = '22222222-2222-2222-2222-222222222222';

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: USER,
    status: 'queued',
    progress: 0,
    sourceType: 'tiktok',
    sourceRef: 'https://tiktok.com/@x/video/1',
    recipeId: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ImportService (TC-7 / AC-2/4/8)', () => {
  it('create classifies the source, inserts a queued row, and enqueues once under the same id', async () => {
    const created = makeJob();
    const repo = { create: vi.fn(async () => created) } as unknown as ImportJobRepository;
    const enqueue = vi.fn<EnqueueImport>(async () => {});
    const service = new ImportService(repo, enqueue);

    const result = await service.create(USER, { url: 'https://www.tiktok.com/@x/video/1' });

    const createArg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg).toMatchObject({ userId: USER, sourceType: 'tiktok' });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0][0].jobId).toBe(createArg.id);
    expect(result).toEqual({ id: created.id, status: 'queued', progress: 0, source_type: 'tiktok' });
  });

  it('create throws UNSUPPORTED and never inserts or enqueues for an unsupported source', async () => {
    const repo = { create: vi.fn() } as unknown as ImportJobRepository;
    const enqueue = vi.fn<EnqueueImport>(async () => {});
    const service = new ImportService(repo, enqueue);

    await expect(service.create(USER, { url: 'https://instagram.com/someprofile' })).rejects.toBeInstanceOf(
      UnsupportedSourceError,
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('get returns the owner-scoped public job', async () => {
    const job = makeJob({ status: 'running', progress: 10 });
    const repo = {
      findByIdForUser: vi.fn(async () => job),
      findRecipeIds: vi.fn(async () => []),
    } as unknown as ImportJobRepository;
    const service = new ImportService(repo, vi.fn());

    expect(await service.get(USER, job.id)).toMatchObject({ status: 'running', progress: 10 });
    expect(repo.findByIdForUser).toHaveBeenCalledWith(job.id, USER);
  });

  it('get throws NotFound for a missing or foreign id', async () => {
    const repo = { findByIdForUser: vi.fn(async () => null) } as unknown as ImportJobRepository;
    const service = new ImportService(repo, vi.fn());
    await expect(service.get(USER, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
