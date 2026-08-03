import { DBOS } from '@dbos-inc/dbos-sdk';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index.js';
import { appDataSource } from './bootstrap.js';
import { ImportJobRepository, type DbExecutor, type TerminalUpdate } from '../repositories/import-job-repository.js';
import { getParseProvider, type ParseInput, type ParseOutcome } from './parse-step.js';
import type { SourceType } from '../db/schema/enums.js';

/** The workflow's durable input: the resolved source + owner for the queued job
 * whose id equals the workflow id. */
export interface ImportWorkflowInput {
  jobId: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
}

/** The DBOS transaction client, valid only inside a runTransaction body. */
function txExecutor(): DbExecutor {
  return appDataSource.client as unknown as NodePgDatabase<typeof schema>;
}

const repo = ImportJobRepository.create();

/** Marks the job `running`. A DBOS transaction so the write commits atomically
 * with the step checkpoint and is skipped on replay (AC-5). */
async function markRunning(jobId: string): Promise<void> {
  await appDataSource.runTransaction(() => repo.setRunning(jobId, 10, txExecutor()), {
    name: 'importMarkRunning',
  });
}

/** Persists the terminal status (+ error code / recipe). Transactional, atomic
 * with the checkpoint; a replay reuses the recorded result rather than re-writing. */
async function markTerminal(jobId: string, update: TerminalUpdate): Promise<void> {
  await appDataSource.runTransaction(() => repo.setTerminal(jobId, update, txExecutor()), {
    name: 'importMarkTerminal',
  });
}

/** Runs the injected parse provider as a durable step, so its (possibly
 * non-deterministic) outcome is checkpointed and reused on resume. Reads
 * getParseProvider() inside the body so a test-swapped provider is picked up. */
async function runParse(input: ParseInput): Promise<ParseOutcome> {
  return DBOS.runStep(() => getParseProvider()(input), { name: 'importParse' });
}

/** Maps a parse outcome to the terminal DB update (AC-6). */
function toTerminalUpdate(outcome: ParseOutcome): TerminalUpdate {
  if (outcome.outcome === 'ready') return { status: 'ready', progress: 100, recipeId: outcome.recipeId };
  return { status: 'failed', progress: 100, errorCode: outcome.errorCode };
}

/**
 * The import pipeline skeleton (O-08). Given an already-queued job, it writes
 * `running`, runs the injectable parse step, then writes the terminal status —
 * every status change through `appDataSource.runTransaction` so it commits
 * atomically with the DBOS checkpoint. Deterministic and idempotent: on a
 * mid-run crash it resumes from the last completed step and never double-applies
 * a transition (AC-5). Real fetch/extract arrive in WI-04/WI-05 behind the
 * parse-step seam.
 */
async function importWorkflowFn(input: ImportWorkflowInput): Promise<void> {
  await markRunning(input.jobId);
  const outcome = await runParse(input);
  await markTerminal(input.jobId, toTerminalUpdate(outcome));
}

/** Registered import workflow. Started with
 * `DBOS.startWorkflow(importWorkflow, { workflowID: jobId })(input)`. */
export const importWorkflow = DBOS.registerWorkflow(importWorkflowFn, { name: 'importWorkflow' });

/** Enqueues an import job's workflow under its own id (= the job row id) so the
 * durable run and the DB row share a deterministic identifier. */
export async function startImportWorkflow(input: ImportWorkflowInput): Promise<void> {
  await DBOS.startWorkflow(importWorkflow, { workflowID: input.jobId })(input);
}
