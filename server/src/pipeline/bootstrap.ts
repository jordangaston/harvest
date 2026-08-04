import { DBOS } from '@dbos-inc/dbos-sdk';
import { env } from '../config/env.js';

/**
 * Configures and launches the in-process DBOS runtime. Workflows and steps
 * register themselves when their classes are imported (the decorators run at
 * class load), so this just points DBOS at its system database and launches.
 * Fastify listens only after this resolves.
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
  await DBOS.launch();
}

/** Gracefully stops the DBOS runtime (safe to call on shutdown). */
export async function shutdownDbos(): Promise<void> {
  await DBOS.shutdown();
}
