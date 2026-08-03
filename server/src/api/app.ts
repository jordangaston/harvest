import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

export interface BuildAppOptions {
  logger?: boolean;
}

async function dbReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

// GET /healthz → 200 when the DB is reachable, else 503. Business routes
// register here in later tickets.
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/healthz', async (_request, reply) => {
    const status = (await dbReachable()) ? 'ok' : 'error';
    reply.code(status === 'ok' ? 200 : 503);
    return { status, db: status };
  });

  return app;
}
