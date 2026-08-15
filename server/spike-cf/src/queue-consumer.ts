import type { ImportInput } from './domain.js';

/** The Workflow binding the consumer needs to start an import. */
export interface WorkflowEnv {
  IMPORT_WORKFLOW: Workflow;
}

/**
 * Start the durable Workflow for one enqueued import. Idempotent by design: the
 * Workflow instance id IS the jobId, so a queue redelivery (Queues is
 * at-least-once) whose Workflow already exists is a **successful no-op**, not an
 * error — the caller acks it. Any other failure throws, so the caller retries.
 * @param env - carries the IMPORT_WORKFLOW binding.
 * @param msg - the enqueued import (jobId + owner + resolved source).
 */
export async function startImport(env: WorkflowEnv, msg: ImportInput): Promise<void> {
  try {
    await env.IMPORT_WORKFLOW.create({ id: msg.jobId, params: msg });
  } catch (err) {
    if (isAlreadyExists(err)) return; // a prior delivery already started it — done
    throw err; // transient (e.g. Workflows unavailable) — let the queue retry
  }
}

/** A Workflows "instance already exists" error — the idempotency signal. */
function isAlreadyExists(err: unknown): boolean {
  return err instanceof Error && /already exists|instance.*exists/i.test(err.message);
}
