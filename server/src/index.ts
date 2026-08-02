import { sql } from 'drizzle-orm';
import { env } from './config/env.js';
import { buildContainer, type Container } from './container.js';
import { initDbos, shutdownDbos } from './pipeline/bootstrap.js';
import { buildApp } from './api/app.js';
import type { FastifyInstance } from 'fastify';

async function main(): Promise<void> {
  const container: Container = buildContainer();

  await container.db.execute(sql`select 1`);
  console.log('db connected');

  await initDbos();
  console.log('dbos launched');

  const app: FastifyInstance = buildApp(container, { logger: true });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log('listening');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    try {
      await app.close();
      await shutdownDbos();
      await container.close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
