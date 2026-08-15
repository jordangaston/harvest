import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { ImportStore } from './db.js';
import { fetchSource, extract } from './providers.js';
import { toRecipeRow, hasRecipe } from './mapping.js';
import { ImportError, type ImportInput } from './domain.js';

export interface Env {
  DB: D1Database;
  IMPORT_WORKFLOW: Workflow;
}

/**
 * The durable import workflow — the Cloudflare Workflows port of DBOS's
 * `ImportWorkflow` + `ImportPipeline`. Its shape is unchanged from server/src:
 * mark running, run the pipeline (fetch → extract → persist) as durable steps,
 * write the terminal status. Never throws — every outcome is a recorded status.
 *
 * DBOS `@DBOS.step` → Cloudflare `step.do(name, cb)`. Each step's result is
 * checkpointed and replay-safe: if a later step fails or the instance is
 * evicted, the engine re-enters `run()` and completed steps return their cached
 * value WITHOUT re-executing — the same durability guarantee DBOS gave us. Steps
 * pass only serializable data (URLs/text/records), never Buffers.
 */
export class ImportWorkflow extends WorkflowEntrypoint<Env, ImportInput> {
  async run(event: WorkflowEvent<ImportInput>, step: WorkflowStep): Promise<void> {
    const input = event.payload;
    const store = ImportStore.of(this.env.DB);

    // Retry policy for the network-shaped steps — bounded + fast so a transient
    // failure resumes quickly and a hard failure fails the step (→ catch below).
    const retry = { retries: { limit: 5, delay: '1 second' as const, backoff: 'constant' as const } };

    try {
      await step.do('mark-running', async () => {
        console.log(`[step] mark-running job=${input.jobId}`);
        await store.setRunning(input.jobId);
      });

      const material = await step.do('fetch-source', retry, async () => {
        console.log(`[step] fetch-source job=${input.jobId}`);
        return fetchSource(input);
      });

      const recipe = await step.do('extract', retry, async () => {
        console.log(`[step] extract job=${input.jobId}`);
        // Proof-only durable-recovery fault: throw once on the first entry. The
        // retry re-enters ONLY this step (upstream steps are memoized) and the
        // D1-persisted counter proves the surrounding state survived the failure.
        if (input.faultStep === 'extract') {
          const attempt = await store.bumpFaultAttempts(input.jobId);
          if (attempt === 1) throw new Error('injected transient fault (extract) — expect a retry');
        }
        const data = await extract(material);
        if (!hasRecipe(data)) throw new ImportError('NO_RECIPE');
        return data;
      });

      await step.do('persist-and-ready', async () => {
        console.log(`[step] persist-and-ready job=${input.jobId}`);
        await store.persistAndReady(toRecipeRow(recipe, input), input);
      });
    } catch (err) {
      // The pipeline exhausted a step's retries (or hit a hard error). Record the
      // terminal failure — the workflow itself never throws (mirrors DBOS).
      await step.do('mark-failed', async () => {
        console.log(`[step] mark-failed job=${input.jobId} code=${ImportError.codeOf(err)}`);
        await store.setFailed(input.jobId, ImportError.codeOf(err));
      });
    }
  }
}
