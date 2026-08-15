import { describe, it, expect } from 'vitest';
import { startImport, type WorkflowEnv } from '../src/queue-consumer.js';
import type { ImportInput } from '../src/domain.js';

const msg: ImportInput = { jobId: 'job-1', userId: 'u1', sourceType: 'website', sourceRef: 'https://x.test/r' };

/** A fake Workflow binding whose `create` runs a supplied behaviour. */
function fakeEnv(create: (opts: { id: string; params: unknown }) => Promise<unknown>): WorkflowEnv {
  return { IMPORT_WORKFLOW: { create } as unknown as Workflow };
}

describe('startImport (queue → workflow, idempotent)', () => {
  it('starts the Workflow with id = jobId and the message as params', async () => {
    const calls: { id: string; params: unknown }[] = [];
    await startImport(fakeEnv(async (o) => (calls.push(o), { id: o.id })), msg);
    expect(calls).toEqual([{ id: 'job-1', params: msg }]);
  });

  it('treats an "instance already exists" redelivery as a successful no-op', async () => {
    await expect(
      startImport(fakeEnv(async () => { throw new Error('instance with id job-1 already exists'); }), msg),
    ).resolves.toBeUndefined();
  });

  it('rethrows a transient failure so the queue retries', async () => {
    await expect(
      startImport(fakeEnv(async () => { throw new Error('Workflows temporarily unavailable'); }), msg),
    ).rejects.toThrow(/unavailable/);
  });
});
