import Fastify, { type FastifyInstance, type preHandlerAsyncHookHandler } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Container } from '../container.js';
import { dbosHealthy } from '../pipeline/bootstrap.js';
import type { OtpService } from '../services/otp-service.js';
import type { UserService } from '../services/user-service.js';
import { registerOtpRoutes } from './routes/otp-routes.js';
import { registerUserRoutes } from './routes/user-routes.js';
import { toErrorReply } from './errors.js';

/**
 * The auth surface's dependencies. When present, `buildApp` registers the OTP
 * and user routes; when absent (e.g. the health-only tests), only `/healthz`
 * is mounted. Assembled in the composition root (container.ts).
 */
export interface AuthDeps {
  otpService: OtpService;
  userService: UserService;
  authGuard: preHandlerAsyncHookHandler;
}

export interface BuildAppOptions {
  logger?: boolean;
  /** Overrides the DBOS liveness probe in tests. Defaults to dbosHealthy(). */
  checkDbos?: () => boolean;
  /** Phone-auth dependencies; when set, the auth routes are registered. */
  auth?: AuthDeps;
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

  // Translate thrown domain errors (and Zod failures) into the API's
  // { error: { code, message } } shape; never leak internals on a 500.
  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = toErrorReply(error);
    reply.code(status).send(body);
  });

  app.get('/healthz', async (_request, reply) => {
    const db = await probeDb(container);
    const dbos: ComponentStatus = checkDbos() ? 'ok' : 'error';
    const status: ComponentStatus = db === 'ok' && dbos === 'ok' ? 'ok' : 'error';
    reply.code(status === 'ok' ? 200 : 503);
    return { status, db, dbos };
  });

  const auth = options.auth ?? container.auth;
  if (auth) {
    registerOtpRoutes(app, auth.otpService);
    registerUserRoutes(app, auth.userService, auth.authGuard);
  }

  return app;
}
