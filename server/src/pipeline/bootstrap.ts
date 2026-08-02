import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import * as schema from '../db/schema/index.js';
import { users } from '../db/schema/index.js';

/**
 * The DBOS Drizzle transactional data source. It manages its OWN interactive
 * `pg` pool (built from the app DATABASE_URL) so that a domain write (later
 * tickets: `import_jobs`) and the workflow checkpoint commit in a single atomic
 * transaction. Constructed at module load, which self-registers it with DBOS.
 * `neon-http` is unsupported — it needs an interactive connection, so pass
 * Neon's pooled/TCP URL in prod.
 */
export const appDataSource = new DrizzleDataSource<NodePgDatabase<typeof schema>>(
  'harvest-app',
  { connectionString: requireDatabaseUrl() },
);

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to construct the DBOS data source');
  return url;
}

/** Transactional Drizzle client, valid only inside a runTransaction callback. */
function tx(): NodePgDatabase<typeof schema> {
  return appDataSource.client as NodePgDatabase<typeof schema>;
}

/**
 * Smoke step: no external I/O, just proves a durable step runs and checkpoints.
 */
async function ping(): Promise<'pong'> {
  return 'pong';
}

/** Generates the throwaway phone. Runs in a step so the value is checkpointed
 * and replays reuse it — nondeterministic input must never sit in a bare
 * workflow body. */
async function newSmokePhone(): Promise<string> {
  return `+1999${randomUUID().replace(/\D/g, '').slice(0, 7)}`;
}

/**
 * Smoke transaction: inserts a throwaway user row and reads it back within the
 * same DBOS transaction, proving the data source writes and the checkpoint
 * commit atomically.
 */
async function insertAndReadBack(phone: string): Promise<string> {
  const [inserted] = await tx()
    .insert(users)
    .values({ phone, jwtPrivateKey: 'smoke', jwtPublicKey: 'smoke' })
    .returning({ id: users.id });
  const [read] = await tx().select({ id: users.id }).from(users).where(eq(users.id, inserted.id));
  return read.id;
}

async function pingWorkflowFn(): Promise<{ step: 'pong'; insertedId: string }> {
  const step = await DBOS.runStep(() => ping(), { name: 'ping' });
  const phone = await DBOS.runStep(() => newSmokePhone(), { name: 'newSmokePhone' });
  const insertedId = await appDataSource.runTransaction(() => insertAndReadBack(phone), {
    name: 'insertAndReadBack',
  });
  return { step, insertedId };
}

/**
 * Registered smoke workflow proving the wired DBOS runtime: one durable step
 * returning "pong" plus one transactional insert-and-read-back. Started with
 * DBOS.startWorkflow(pingWorkflow, { workflowID })().
 */
export const pingWorkflow = DBOS.registerWorkflow(pingWorkflowFn, { name: 'pingWorkflow' });

/**
 * Configures and launches the in-process DBOS runtime. Order (per DBOS docs):
 * data source + workflows register at module load, then setConfig →
 * initializeDBOSSchema (idempotent; creates dbos.transaction_completion) →
 * launch. Fastify listens only after this resolves.
 */
export async function initDbos(): Promise<void> {
  const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;
  const appDatabaseUrl = process.env.DATABASE_URL;
  if (!systemDatabaseUrl) throw new Error('DBOS_SYSTEM_DATABASE_URL is required to launch DBOS');
  if (!appDatabaseUrl) throw new Error('DATABASE_URL is required to launch DBOS');

  DBOS.setConfig({ name: 'harvest', systemDatabaseUrl });
  await DrizzleDataSource.initializeDBOSSchema({ connectionString: appDatabaseUrl });
  await DBOS.launch();
}

/** Gracefully stops the DBOS runtime (idempotent-safe on shutdown). */
export async function shutdownDbos(): Promise<void> {
  await DBOS.shutdown();
}

/** True once DBOS has launched and not yet shut down. */
export function dbosHealthy(): boolean {
  return DBOS.isInitialized();
}
