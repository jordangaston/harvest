import { sql } from 'drizzle-orm';
import { env } from './config/env.js';
import { db, pool } from './db/index.js';
import { buildApp } from './api/app.js';
import { initDbos, shutdownDbos } from './pipeline/bootstrap.js';
import { setParseProvider } from './pipeline/parse-step.js';
import { createParseProvider } from './parse/parse-provider.js';
import type { FastifyInstance } from 'fastify';

// Migrations run as a deploy step (npm run migrate), not on boot.
async function main(): Promise<void> {
  await db.execute(sql`select 1`);
  console.log('db connected');

  setParseProvider(createParseProvider());
  await initDbos();
  console.log('dbos launched');

  const app: FastifyInstance = buildApp({ logger: true });
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
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('shutdown failed', err);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
