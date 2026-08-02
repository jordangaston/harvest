import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContainer } from './container.js';
import type { Db } from './db/index.js';

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
});
