import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Container } from '../container.js';
import { dbosHealthy } from '../pipeline/bootstrap.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Overrides the DBOS liveness probe in tests. Defaults to dbosHealthy(). */
  checkDbos?: () => boolean;
}

type ComponentStatus = 'ok' | 'error';

async function probeDb(container: Container): Promise<ComponentStatus> {
  try {
    await container.db.execute(sql`select 1`);
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * Builds the Fastify app. Currently only the health surface exists; business
 * controllers are registered here by later tickets. `GET /healthz` returns 200
 * with every component "ok", or 503 naming the failing component.
 */
export function buildApp(container: Container, options: BuildAppOptions = {}): FastifyInstance {
  const checkDbos = options.checkDbos ?? dbosHealthy;
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/healthz', async (_request, reply) => {
    const db = await probeDb(container);
    const dbos: ComponentStatus = checkDbos() ? 'ok' : 'error';
    const status: ComponentStatus = db === 'ok' && dbos === 'ok' ? 'ok' : 'error';
    reply.code(status === 'ok' ? 200 : 503);
    return { status, db, dbos };
  });

  return app;
}
