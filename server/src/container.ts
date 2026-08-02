import twilio from 'twilio';
import { createDb, type Db, type Database } from './db/index.js';
import { env } from './config/env.js';
import {
  StubOtpProvider,
  TwilioVerifyOtpProvider,
  type OtpProvider,
} from './providers/otp-provider.js';
import { OtpService } from './services/otp-service.js';
import { AuthService } from './services/auth-service.js';
import { UserRepository } from './repositories/user-repository.js';
import { UserService } from './services/user-service.js';
import { makeAuthGuard } from './api/middleware/auth-guard.js';
import type { AuthDeps } from './api/app.js';

/**
 * The composition root's product: every long-lived dependency the app and
 * tests share. New tickets add repositories and services as fields here; they
 * are constructed with plain `new`, no DI container or decorators.
 */
export interface Container {
  db: Database;
  /** Underlying connection pool — exposed for health checks and teardown. */
  pool: Db['pool'];
  /** Drains the pool. Call on shutdown / after tests. */
  close: () => Promise<void>;
  /** Phone-auth surface passed to buildApp to register the auth routes.
   * Optional so health-only test containers can omit it. */
  auth?: AuthDeps;
}

/**
 * Fields callers may override — tests pass a `db`/pool built against an
 * ephemeral Postgres, or stub services. Anything omitted is constructed from
 * real config.
 *
 * `otpProvider` lets tests inject a StubOtpProvider (no SMS / no spend);
 * `userRepository` lets a test inject a failing repository to exercise the
 * provisioning rollback (TC-4).
 */
export interface ContainerOverrides {
  db?: Db;
  otpProvider?: OtpProvider;
  userRepository?: UserRepository;
}

/**
 * Selects the OTP provider: Twilio Verify in production (requires all three
 * TWILIO_* vars, validated here), otherwise the in-memory stub for dev/tests.
 *
 * @throws {Error} In production when a TWILIO_* var is missing.
 */
function selectOtpProvider(): OtpProvider {
  if (env.NODE_ENV !== 'production') return new StubOtpProvider();

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    throw new Error(
      'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID are required in production',
    );
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return new TwilioVerifyOtpProvider(client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID));
}

/**
 * Builds the dependency graph by hand. `buildContainer()` uses real config;
 * tests pass overrides. Used by both index.ts and the test harness so prod and
 * tests wire the same graph.
 */
export function buildContainer(overrides: ContainerOverrides = {}): Container {
  const dbHandle = overrides.db ?? createDb(env.DATABASE_URL);

  const otpProvider = overrides.otpProvider ?? selectOtpProvider();
  const userRepo = overrides.userRepository ?? new UserRepository(dbHandle.db);
  const authService = new AuthService();
  const otpService = new OtpService(otpProvider);
  const userService = new UserService(dbHandle.db, userRepo, authService, otpService);
  const authGuard = makeAuthGuard({ authService, userRepo });

  return {
    db: dbHandle.db,
    pool: dbHandle.pool,
    close: dbHandle.close,
    auth: { otpService, userService, authGuard },
  };
}
