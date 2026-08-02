import { TEST_DATABASE_URL } from './integration-env.js';
import { buildContainer, type Container } from '../../src/container.js';
import { createDb } from '../../src/db/index.js';
import { initDbos, shutdownDbos } from '../../src/pipeline/bootstrap.js';

let container: Container | undefined;
let launched = false;

/**
 * Launches DBOS once for the integration project (single-fork) and returns a
 * container built against the local test database. Safe to call from multiple
 * specs; the DBOS runtime and pool are shared.
 */
export async function getHarness(): Promise<Container> {
  if (!launched) {
    await initDbos();
    launched = true;
  }
  // env.DATABASE_URL is empty under VITEST, so build the container from the
  // explicit test URL (localhost -> the pg driver).
  if (!container) container = buildContainer({ db: createDb(TEST_DATABASE_URL) });
  return container;
}

/** Tears down the shared DBOS runtime and drains the container's pool. */
export async function teardownHarness(): Promise<void> {
  if (container) {
    await container.close();
    container = undefined;
  }
  if (launched) {
    await shutdownDbos();
    launched = false;
  }
}
