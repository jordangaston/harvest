import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { UserService, type Resolution } from '../services/user-service.js';
import { OtpService } from '../services/otp-service.js';
import { authGuard } from './middleware/auth-guard.js';
import { registerErrorHandler, OtpRequestFailedError, InvalidOtpError } from './errors.js';
import { createUserSchema, requestOtpSchema, signInSchema, verifyOtpSchema } from './schemas.js';
import { toPublicUser } from '../models/user.js';
import { normalizeE164 } from '../util/phone.js';

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
  const users = UserService.create();
  const otps = OtpService.create();

  app.get('/healthz', async (_request, reply) => {
    const status = (await dbReachable()) ? 'ok' : 'error';
    reply.code(status === 'ok' ? 200 : 503);
    return { status, db: status };
  });

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

  app.post('/v1/otps/verify', async (request) => {
    const { otp } = verifyOtpSchema.parse(request.body);
    if (!(await otps.verifyOtp(otp.phone_number, otp.code))) throw new InvalidOtpError();
    return { otp: { status: 'approved' } };
  });

  app.post('/v1/users', async (request) => {
    const { user } = createUserSchema.parse(request.body);
    const resolved = await users.createUser({ phoneNumber: user.phone_number, onboarding: user.onboarding });
    return sessionResponse(resolved);
  });

  app.post('/v1/users/sign_in', async (request) => {
    const { auth } = signInSchema.parse(request.body);
    return sessionResponse(await users.signIn(auth));
  });

  app.get('/v1/users/me', { preHandler: authGuard }, async (request) => {
    const me = await users.getMe(request.authUserId!);
    return { user: me };
  });

  registerErrorHandler(app);
  return app;
}

function sessionResponse(resolved: Resolution) {
  return {
    user: toPublicUser(resolved.user),
    auth: { access_token: resolved.tokens.access_token, refresh_token: resolved.tokens.refresh_token },
    isNew: resolved.isNew,
  };
}
