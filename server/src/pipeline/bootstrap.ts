import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import * as schema from '../db/schema/index.js';
import { users } from '../db/schema/index.js';

// DBOS's transactional data source: its own interactive pg pool, so a domain
// write and the workflow checkpoint commit atomically. neon-http won't work
// (no interactive txns) — use Neon's TCP endpoint. Self-registers at module load.
export const appDataSource = new DrizzleDataSource<NodePgDatabase<typeof schema>>(
  'harvest-app',
  { connectionString: requireDatabaseUrl() },
);

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to construct the DBOS data source');
  return url;
}

function tx(): NodePgDatabase<typeof schema> {
  return appDataSource.client as NodePgDatabase<typeof schema>;
}

// ponytail: scaffold DBOS smoke — one step + one transactional write, proving
// the runtime is wired. Delete once WI-03's real import workflow covers it.
async function newSmokePhone(): Promise<string> {
  return `+1999${randomUUID().replace(/\D/g, '').slice(0, 7)}`;
}

async function insertAndReadBack(phone: string): Promise<string> {
  const [inserted] = await tx()
    .insert(users)
    .values({ phone, jwtPrivateKey: 'smoke', jwtPublicKey: 'smoke' })
    .returning({ id: users.id });
  const [read] = await tx().select({ id: users.id }).from(users).where(eq(users.id, inserted.id));
  return read.id;
}

async function pingWorkflowFn(): Promise<{ step: 'pong'; insertedId: string }> {
  // Nondeterministic input goes in a step so it's checkpointed (replays reuse it).
  const step = await DBOS.runStep(async () => 'pong' as const, { name: 'ping' });
  const phone = await DBOS.runStep(() => newSmokePhone(), { name: 'newSmokePhone' });
  const insertedId = await appDataSource.runTransaction(() => insertAndReadBack(phone), {
    name: 'insertAndReadBack',
  });
  return { step, insertedId };
}

export const pingWorkflow = DBOS.registerWorkflow(pingWorkflowFn, { name: 'pingWorkflow' });

export async function initDbos(): Promise<void> {
  const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;
  const appDatabaseUrl = process.env.DATABASE_URL;
  if (!systemDatabaseUrl) throw new Error('DBOS_SYSTEM_DATABASE_URL is required to launch DBOS');
  if (!appDatabaseUrl) throw new Error('DATABASE_URL is required to launch DBOS');

  // Order matters: config → create the dbos system schema → launch.
  DBOS.setConfig({ name: 'harvest', systemDatabaseUrl });
  await DrizzleDataSource.initializeDBOSSchema({ connectionString: appDatabaseUrl });
  await DBOS.launch();
}

export async function shutdownDbos(): Promise<void> {
  await DBOS.shutdown();
}

export function dbosHealthy(): boolean {
  return DBOS.isInitialized();
}
