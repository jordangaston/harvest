import { initDbos, shutdownDbos } from '../../src/pipeline/bootstrap.js';

let launched = false;

/** Launches the in-process DBOS runtime once for the integration file. The
 * DrizzleDataSource self-registers at module load; this only connects + launches. */
export async function startDbos(): Promise<void> {
  if (launched) return;
  await initDbos();
  launched = true;
}

/** Tears the DBOS runtime down (idempotent). */
export async function stopDbos(): Promise<void> {
  if (!launched) return;
  await shutdownDbos();
  launched = false;
}
