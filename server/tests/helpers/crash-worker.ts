/**
 * A child worker for the crash-resume test (TC-6). It starts an import workflow
 * whose parse step hangs forever, prints `RUNNING` once the job row reaches
 * `running`, then blocks. The parent SIGKILLs it — a true crash that leaves the
 * workflow mid-step with no recorded step result, so recovery on the parent
 * re-runs the parse step and drives the job to terminal exactly once (AC-5).
 * Run via `node --import tsx`.
 *
 * argv: [jobId, userId, sourceRef]
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { importJobs } from '../../src/db/schema/index.js';
import { initDbos } from '../../src/pipeline/bootstrap.js';
import { startImportWorkflow } from '../../src/pipeline/import-workflow.js';
import { setParseProvider } from '../../src/pipeline/parse-step.js';

const [jobId, userId, sourceRef] = process.argv.slice(2);

async function main(): Promise<void> {
  // Hang forever so the step is in-flight (no recorded result) when we're killed.
  setParseProvider(() => new Promise(() => {}));
  await initDbos();
  await db.insert(importJobs).values({ id: jobId, userId, status: 'queued', sourceType: 'tiktok', sourceRef });
  await startImportWorkflow({ jobId, userId, sourceType: 'tiktok', sourceRef });

  for (;;) {
    const [row] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (row?.status === 'running') {
      process.stdout.write('RUNNING\n');
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise(() => {}); // hang until the parent SIGKILLs us
}

void main();
