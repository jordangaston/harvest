import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index.js';
import { env } from '../config/env.js';

/**
 * The DBOS Drizzle transactional data source. It builds its OWN interactive
 * `pg` pool (from the app DATABASE_URL, separate from the `db` singleton) so a
 * domain write to `import_jobs` and the DBOS workflow checkpoint commit in a
 * single atomic transaction. Constructed at module load, which self-registers
 * it with DBOS. Neon's serverless/http driver is unsupported — pass the pooled
 * TCP URL in prod.
 */
export const appDataSource = new DrizzleDataSource<NodePgDatabase<typeof schema>>('harvest-app', {
  connectionString: env.DATABASE_URL,
});

/**
 * Configures and launches the in-process DBOS runtime. Order (per DBOS docs):
 * the data source + workflows register at module load, then setConfig →
 * initializeDBOSSchema (idempotent; creates the dbos system tables) → launch.
 * Fastify listens only after this resolves.
 */
export async function initDbos(): Promise<void> {
  // Recovery of interrupted workflows is scoped to (executorID, appVersion), so
  // both must be stable across a restart for a crashed run to be recovered. Pin
  // them (defaulting to DBOS's own 'local' + a fixed version) rather than let
  // DBOS derive a per-process appVersion hash, which would differ between a
  // crashed worker and the process that recovers it. In prod the platform sets
  // DBOS__VMID / DBOS__APPVERSION per deploy.
  DBOS.setConfig({
    name: 'harvest',
    systemDatabaseUrl: env.DBOS_SYSTEM_DATABASE_URL,
    executorID: process.env.DBOS__VMID ?? 'local',
    applicationVersion: process.env.DBOS__APPVERSION ?? 'harvest',
  });
  await DrizzleDataSource.initializeDBOSSchema({ connectionString: env.DATABASE_URL });
  await DBOS.launch();
}

/** Gracefully stops the DBOS runtime (safe to call on shutdown). */
export async function shutdownDbos(): Promise<void> {
  await DBOS.shutdown();
}
