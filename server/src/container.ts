import { createDb, type Db, type Database } from './db/index.js';
import { env } from './config/env.js';

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
}

/**
 * Fields callers may override — tests pass a `db`/pool built against an
 * ephemeral Postgres (or stub services in later tickets). Anything omitted is
 * constructed from real config.
 *
 * `otpProvider`/`userRepository` let tests inject a StubOtpProvider or a
 * failing repository without touching the network or spending on SMS. Their
 * concrete types land with the provider/repository in later tasks; the real
 * container wiring that consumes them is deferred to task 11.
 */
export interface ContainerOverrides {
  db?: Db;
  otpProvider?: unknown;
  userRepository?: unknown;
}

/**
 * Builds the dependency graph by hand. `buildContainer()` uses real config;
 * tests pass overrides. Used by both index.ts and the test harness so prod and
 * tests wire the same graph.
 */
export function buildContainer(overrides: ContainerOverrides = {}): Container {
  const dbHandle = overrides.db ?? createDb(env.DATABASE_URL);
  return {
    db: dbHandle.db,
    pool: dbHandle.pool,
    close: dbHandle.close,
  };
}
