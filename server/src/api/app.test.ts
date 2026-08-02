import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildApp } from './app.js';
import type { Container } from '../container.js';

function containerWith(execute: () => Promise<unknown>): Container {
  return {
    db: { execute } as unknown as Container['db'],
    pool: {} as Container['pool'],
    close: async () => {},
  };
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
function make(container: Container, checkDbos: () => boolean) {
  const app = buildApp(container, { checkDbos });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /healthz (TC-4)', () => {
  it('returns 200 with all components ok when db and dbos are healthy', async () => {
    const app = make(containerWith(() => Promise.resolve()), () => true);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', dbos: 'ok' });
  });

  it('returns 503 with db:error when the database is unreachable', async () => {
    const execute = vi.fn(() => Promise.reject(new Error('connection refused')));
    const app = make(containerWith(execute), () => true);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'error', dbos: 'ok' });
  });

  it('returns 503 with dbos:error when DBOS is not launched', async () => {
    const app = make(containerWith(() => Promise.resolve()), () => false);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'ok', dbos: 'error' });
  });
});
