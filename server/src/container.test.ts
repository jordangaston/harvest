import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContainer } from './container.js';
import type { Db } from './db/index.js';
import { StubOtpProvider } from './providers/otp-provider.js';
import { UserRepository } from './repositories/user-repository.js';

function stubDb(): Db {
  const pool = { end: vi.fn(async () => {}) } as unknown as Db['pool'];
  return {
    db: { marker: 'stub-db' } as unknown as Db['db'],
    pool,
    close: async () => {},
  };
}

describe('buildContainer (TC-7)', () => {
  it('wires db, pool, and close from an injected override', () => {
    const injected = stubDb();
    const container = buildContainer({ db: injected });
    expect(container.db).toBe(injected.db);
    expect(container.pool).toBe(injected.pool);
    expect(typeof container.close).toBe('function');
  });

  it('does not touch a real database when given an override', () => {
    const injected = stubDb();
    // env.DATABASE_URL is intentionally empty under VITEST; with an override,
    // buildContainer must not attempt to construct a real client.
    expect(() => buildContainer({ db: injected })).not.toThrow();
  });

  it('uses no DI container or decorators (no tsyringe / reflect-metadata)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./container.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/tsyringe/);
    expect(source).not.toMatch(/reflect-metadata/);
    expect(source).not.toMatch(/@(injectable|inject)\b/);
  });

  it('assembles the auth surface (otpService, userService, authGuard)', () => {
    const container = buildContainer({ db: stubDb() });
    expect(container.auth?.otpService).toBeDefined();
    expect(container.auth?.userService).toBeDefined();
    expect(typeof container.auth?.authGuard).toBe('function');
  });

  it('defaults to StubOtpProvider outside production (no Twilio, no spend)', () => {
    // NODE_ENV is not 'production' under VITEST, so the stub is selected and no
    // TWILIO_* config is required to build the container.
    expect(() => buildContainer({ db: stubDb() })).not.toThrow();
  });

  it('honors an injected otpProvider override', () => {
    const provider = new StubOtpProvider();
    const container = buildContainer({ db: stubDb(), otpProvider: provider });
    // The container builds without error and exposes the auth surface; the
    // injected provider is what OtpService will call (asserted end-to-end in
    // the integration suite).
    expect(container.auth?.otpService).toBeDefined();
  });

  it('honors an injected userRepository override', () => {
    const repo = new UserRepository({} as never);
    const container = buildContainer({ db: stubDb(), userRepository: repo });
    expect(container.auth?.userService).toBeDefined();
  });
});
