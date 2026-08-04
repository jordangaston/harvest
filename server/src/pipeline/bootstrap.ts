import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index.js';
import { env } from '../config/env.js';

/**
 * The DBOS Drizzle data source, backing the workflow's `@appDataSource.transaction`
 * status writes. Each such write commits atomically with the DBOS checkpoint, so
 * the `import_jobs` status can never diverge from the workflow's recorded state.
 * Constructed at module load, which self-registers it with DBOS.
 */
export const appDataSource = new DrizzleDataSource<NodePgDatabase<typeof schema>>('harvest-app', {
  connectionString: env.DATABASE_URL,
});

/**
 * Configures and launches the in-process DBOS runtime. The data source and
 * workflows register themselves at module load; this points DBOS at its system
 * database, creates the transaction bookkeeping schema, and launches. Fastify
 * listens only after this resolves.
 */
export async function initDbos(): Promise<void> {
  // Recovery of interrupted workflows is scoped to (executorID, appVersion), so
  // both must be stable across a restart for a crashed run to be recovered. In
  // prod the platform sets DBOS__VMID / DBOS__APPVERSION per deploy.
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
