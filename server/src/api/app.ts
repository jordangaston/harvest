import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { UserService, type Resolution } from '../services/user-service.js';
import { OtpService } from '../services/otp-service.js';
import { authGuard } from './middleware/auth-guard.js';
import { registerErrorHandler, OtpRequestFailedError, InvalidOtpError } from './errors.js';
import { createUserSchema, requestOtpSchema, signInSchema, verifyOtpSchema, createImportSchema } from './schemas.js';
import { toPublicUser } from '../models/user.js';
import { normalizeE164 } from '../util/phone.js';
import { ImportService } from '../services/import-service.js';
import { RecipeService } from '../services/recipe-service.js';

export interface BuildAppOptions {
  logger?: boolean;
}

/**
 * Probes the database with `select 1`.
 * @returns true if the query succeeds, false on any error (backs the health check).
 */
async function dbReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the Fastify app: wires services and registers every route plus the error handler.
 * @param options - `logger` toggles Fastify request logging (default off).
 * @returns a ready-to-listen Fastify instance.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const users = UserService.create();
  const otps = OtpService.create();
  const imports = ImportService.create();
  const recipes = RecipeService.create();

  /** GET /healthz — liveness probe. Public. 200 when the DB is reachable, else 503. */
  app.get('/healthz', async (_request, reply) => {
    const status = (await dbReachable()) ? 'ok' : 'error';
    reply.code(status === 'ok' ? 200 : 503);
    return { status, db: status };
  });

  /**
   * POST /v1/otps — sends an SMS verification code. Public.
   * @throws OtpRequestFailedError 502 if the OTP provider send fails.
   */
  app.post('/v1/otps', async (request) => {
    const { otp } = requestOtpSchema.parse(request.body);
    const phone = normalizeE164(otp.phone_number);
    try {
      await otps.requestOtp(phone);
    } catch {
      throw new OtpRequestFailedError();
    }
    return { otp: { status: 'pending' } };
  });

  /**
   * POST /v1/otps/verify — checks a code without signing in. Public.
   * @throws InvalidOtpError 400 if the code is wrong or expired.
   */
  app.post('/v1/otps/verify', async (request) => {
    const { otp } = verifyOtpSchema.parse(request.body);
    if (!(await otps.verifyOtp(otp.phone_number, otp.code))) throw new InvalidOtpError();
    return { otp: { status: 'approved' } };
  });

  /** POST /v1/users — creates (or resolves an existing) user and returns a session. Public. */
  app.post('/v1/users', async (request) => {
    const { user } = createUserSchema.parse(request.body);
    const resolved = await users.createUser({ phoneNumber: user.phone_number, onboarding: user.onboarding });
    return sessionResponse(resolved);
  });

  /** POST /v1/users/sign_in — exchanges an OTP or refresh token for a session. Public. */
  app.post('/v1/users/sign_in', async (request) => {
    const { auth } = signInSchema.parse(request.body);
    return sessionResponse(await users.signIn(auth));
  });

  /** GET /v1/users/me — returns the authenticated user. Requires bearer token; 401 without one. */
  app.get('/v1/users/me', { preHandler: authGuard }, async (request) => {
    const me = await users.getMe(request.authUserId!);
    return { user: me };
  });

  /**
   * POST /v1/imports — enqueues an import job for the caller. Requires bearer token; 401 without one.
   * Returns 202 with the pending job.
   */
  app.post('/v1/imports', { preHandler: authGuard }, async (request, reply) => {
    const { source } = createImportSchema.parse(request.body);
    const job = await imports.create(request.authUserId!, source);
    reply.code(202);
    return { job };
  });

  /**
   * GET /v1/imports/:id — fetches one of the caller's import jobs. Requires bearer token; 401 without one.
   * Scoped to the authenticated user, so another user's id reads as not found.
   */
  app.get<{ Params: { id: string } }>('/v1/imports/:id', { preHandler: authGuard }, async (request) => {
    const job = await imports.get(request.authUserId!, request.params.id);
    return { job };
  });

  /**
   * GET /v1/recipes/:id — fetches a recipe with its ingredients and steps.
   * Requires bearer token; 401 without one. Not owner-scoped — recipes are shared,
   * so any authenticated caller can open one while browsing. 404 if the id is unknown.
   */
  app.get<{ Params: { id: string } }>('/v1/recipes/:id', { preHandler: authGuard }, async (request) => {
    const recipe = await recipes.get(request.params.id);
    return { recipe };
  });

  registerErrorHandler(app);
  return app;
}

/**
 * Shapes a resolved user + tokens into the wire session payload.
 * @param resolved - user, token pair, and whether the account was just created.
 */
function sessionResponse(resolved: Resolution) {
  return {
    user: toPublicUser(resolved.user),
    auth: { access_token: resolved.tokens.access_token, refresh_token: resolved.tokens.refresh_token },
    isNew: resolved.isNew,
  };
}
