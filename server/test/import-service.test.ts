import { describe, it, expect, vi, beforeEach } from "vitest";

// The queue send() is a module-level import in import-service; mock it so the
// intake never touches the real Vercel Queue. `vi.hoisted` builds the spy before
// the (hoisted) vi.mock factory and the SUT import run.
const { send } = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock("../src/queue.js", () => ({ send, handleCallback: vi.fn() }));

import { ImportService, IMPORT_TOPIC } from "../src/import-service.js";
import { ImportJobRepository } from "../src/repositories/import-job-repository.js";
import type { ImportJob } from "../src/models/import-job.js";

// Ported from main's tests/unit/import-service.test.ts, adapted to the migrated
// stack: the queue is a module import (mocked), `create` returns null for an
// unsupported source (the route maps null → 422), and `get` returns null for a
// missing/foreign id (→ 404). Assertions on classify + insert + enqueue-once and
// owner-scoping are preserved.

const USER = "22222222-2222-2222-2222-222222222222";

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: USER,
    status: "queued",
    progress: 0,
    sourceType: "tiktok",
    sourceRef: "https://tiktok.com/@x/video/1",
    recipeId: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => send.mockClear());

describe("ImportService", () => {
  it("create classifies the source, inserts a queued row, and enqueues once under the same id", async () => {
    const created = makeJob();
    const repo = { create: vi.fn(async () => created) } as unknown as ImportJobRepository;
    const service = new ImportService(repo);

    const result = await service.create(USER, { url: "https://www.tiktok.com/@x/video/1" });

    const createArg = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg).toMatchObject({ userId: USER, sourceType: "tiktok" });
    expect(send).toHaveBeenCalledOnce();
    const [topic, message] = send.mock.calls[0] as [string, { jobId: string }];
    expect(topic).toBe(IMPORT_TOPIC);
    expect(message.jobId).toBe(createArg.id);
    expect(result).toEqual({ id: created.id, status: "queued", progress: 0, source_type: "tiktok" });
  });

  it("create returns null and never inserts or enqueues for an unsupported source", async () => {
    const repo = { create: vi.fn() } as unknown as ImportJobRepository;
    const service = new ImportService(repo);

    expect(await service.create(USER, { url: "https://instagram.com/someprofile" })).toBeNull();
    expect(repo.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("get returns the owner-scoped public job", async () => {
    const job = makeJob({ status: "running", progress: 10 });
    const repo = {
      findByIdForUser: vi.fn(async () => job),
      findRecipeIds: vi.fn(async () => []),
    } as unknown as ImportJobRepository;
    const service = new ImportService(repo);

    expect(await service.get(USER, job.id)).toMatchObject({ status: "running", progress: 10 });
    expect(repo.findByIdForUser).toHaveBeenCalledWith(job.id, USER);
  });

  it("get returns null for a missing or foreign id", async () => {
    const repo = { findByIdForUser: vi.fn(async () => null) } as unknown as ImportJobRepository;
    const service = new ImportService(repo);
    expect(await service.get(USER, "nope")).toBeNull();
  });
});
