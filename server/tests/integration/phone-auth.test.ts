import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { getHarness, teardownHarness } from '../helpers/dbos-harness.js';
import { buildApp } from '../../src/api/app.js';
import { buildContainer, type Container } from '../../src/container.js';
import { StubOtpProvider } from '../../src/providers/otp-provider.js';
import { UserRepository } from '../../src/repositories/user-repository.js';

const PHONE_A = '+15555550123';
const PHONE_B = '+15555550999';
const CODE = '123456';

let stub: StubOtpProvider;
let container: Container;

/** Counts users rows via the harness DB (post-commit, real table). */
async function userCount(): Promise<number> {
  const rows = await harness.db
    .execute(sql`select count(*)::int as n from users`)
    .then((r) => (r as { rows: { n: number }[] }).rows);
  return rows[0].n;
}

let harness: Container;

beforeAll(async () => {
  // getHarness launches DBOS once and gives a container against the test DB. We
  // reuse its DB handle to build a container wired with a StubOtpProvider so no
  // Twilio network/spend happens; harness.close() (via teardownHarness) drains
  // the shared pool.
  harness = await getHarness();
  stub = new StubOtpProvider();
  container = buildContainer({
    db: { db: harness.db, pool: harness.pool, close: async () => {} },
    otpProvider: stub,
  });
});

afterAll(async () => {
  await teardownHarness();
});

beforeEach(async () => {
  stub.sent.length = 0;
  stub.approvedCodes.clear();
  await harness.db.execute(sql`delete from users`);
});

describe('TC-1: POST /v1/otps sends a code', () => {
  it('returns 200 { otp: { status: "pending" } } and records the send for valid E.164', async () => {
    const app = buildApp(container);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/otps',
        payload: { otp: { phone_number: PHONE_A } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ otp: { status: 'pending' } });
      expect(stub.sent).toEqual([PHONE_A]);
    } finally {
      await app.close();
    }
  });

  it('returns 400 naming phone_number for a malformed number, with no send', async () => {
    const app = buildApp(container);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/otps',
        payload: { otp: { phone_number: 'not-a-phone' } },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toMatch(/phone_number/);
      expect(stub.sent).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe('TC-2: POST /v1/users provisions an account', () => {
  it('creates the user, returns tokens + isNew, leaks no key/code, writes exactly one row', async () => {
    stub.approvedCodes.set(PHONE_A, CODE);
    const app = buildApp(container);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/users',
        payload: { user: { phone_number: PHONE_A, code: CODE } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.phone).toBe(PHONE_A);
      expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.auth.access_token.jwt).toBeTruthy();
      expect(body.auth.refresh_token.jwt).toBeTruthy();
      expect(body.isNew).toBe(true);

      // no key material or OTP code in the body
      const raw = res.body;
      expect(raw).not.toMatch(/PRIVATE KEY/);
      expect(raw).not.toMatch(/jwtPrivateKey/);
      expect(raw).not.toMatch(new RegExp(CODE));

      expect(await userCount()).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe('TC-3: POST /v1/users rejects a bad OTP', () => {
  it('returns 400 INVALID_OTP and writes zero rows', async () => {
    stub.approvedCodes.set(PHONE_A, CODE);
    const app = buildApp(container);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/users',
        payload: { user: { phone_number: PHONE_A, code: '000000' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_OTP');
      expect(await userCount()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('TC-4: provisioning rolls back atomically', () => {
  it('rolls back to zero rows when create throws after approval, then a normal retry succeeds', async () => {
    stub.approvedCodes.set(PHONE_A, CODE);

    // A repository whose create throws mid-transaction, over the real DB so the
    // interactive transaction must roll back (no partial user row).
    class FailingUserRepository extends UserRepository {
      override async create(): Promise<never> {
        throw new Error('simulated insert failure');
      }
    }
    const failingRepo = new FailingUserRepository(harness.db);
    const failingContainer = buildContainer({
      db: { db: harness.db, pool: harness.pool, close: async () => {} },
      otpProvider: stub,
      userRepository: failingRepo,
    });

    const failApp = buildApp(failingContainer);
    try {
      const res = await failApp.inject({
        method: 'POST',
        url: '/v1/users',
        payload: { user: { phone_number: PHONE_A, code: CODE } },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(await userCount()).toBe(0);
    } finally {
      await failApp.close();
    }

    // A normal retry (healthy container) now succeeds and writes one row.
    const okApp = buildApp(container);
    try {
      const res = await okApp.inject({
        method: 'POST',
        url: '/v1/users',
        payload: { user: { phone_number: PHONE_A, code: CODE } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().isNew).toBe(true);
      expect(await userCount()).toBe(1);
    } finally {
      await okApp.close();
    }
  });
});

describe('TC-5: POST /v1/users/sign_in by OTP find-or-creates', () => {
  it('returns isNew:false / same id / no new row for an existing user; isNew:true / one row for a new number', async () => {
    stub.approvedCodes.set(PHONE_A, '111111');
    stub.approvedCodes.set(PHONE_B, '222222');
    const app = buildApp(container);
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/v1/users/sign_in',
        payload: { auth: { otp: { phone_number: PHONE_A, code: '111111' } } },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().isNew).toBe(true);
      const firstId = first.json().user.id;
      expect(await userCount()).toBe(1);

      // Existing number: same id, isNew false, no new row.
      const again = await app.inject({
        method: 'POST',
        url: '/v1/users/sign_in',
        payload: { auth: { otp: { phone_number: PHONE_A, code: '111111' } } },
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().isNew).toBe(false);
      expect(again.json().user.id).toBe(firstId);
      expect(await userCount()).toBe(1);

      // Brand-new number: isNew true, distinct id, one more row.
      const other = await app.inject({
        method: 'POST',
        url: '/v1/users/sign_in',
        payload: { auth: { otp: { phone_number: PHONE_B, code: '222222' } } },
      });
      expect(other.statusCode).toBe(200);
      expect(other.json().isNew).toBe(true);
      expect(other.json().user.id).not.toBe(firstId);
      expect(await userCount()).toBe(2);
    } finally {
      await app.close();
    }
  });
});

describe('TC-6: POST /v1/users/sign_in by refresh token', () => {
  it('mints fresh tokens without any OTP send/check, and rejects a stale token after a nonce bump', async () => {
    stub.approvedCodes.set(PHONE_A, CODE);
    const app = buildApp(container);
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/users',
        payload: { user: { phone_number: PHONE_A, code: CODE } },
      });
      const userId = created.json().user.id;
      const refreshToken = created.json().auth.refresh_token.jwt;

      stub.sent.length = 0;
      const sentBefore = [...stub.sent];

      const refreshed = await app.inject({
        method: 'POST',
        url: '/v1/users/sign_in',
        payload: { auth: { refresh_token: refreshToken } },
      });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().isNew).toBe(false);
      expect(refreshed.json().user.id).toBe(userId);
      expect(refreshed.json().auth.access_token.jwt).toBeTruthy();
      expect(refreshed.json().auth.refresh_token.jwt).toBeTruthy();
      // the refresh path never touches the OTP provider
      expect(stub.sent).toEqual(sentBefore);

      // Bump the user's refresh nonce (revocation), then reuse the old token.
      const repo = new UserRepository(harness.db);
      await repo.bumpRefreshNonce(userId);
      const reused = await app.inject({
        method: 'POST',
        url: '/v1/users/sign_in',
        payload: { auth: { refresh_token: refreshToken } },
      });
      expect(reused.statusCode).toBe(401);
      expect(reused.json().error.code).toBe('REFRESH_INVALID');
    } finally {
      await app.close();
    }
  });
});

describe('TC-7: authGuard protects GET /v1/users/me', () => {
  it('allows a valid access bearer and rejects missing / refresh-as-access / expired', async () => {
    stub.approvedCodes.set(PHONE_A, CODE);
    const app = buildApp(container);
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/users',
        payload: { user: { phone_number: PHONE_A, code: CODE } },
      });
      const userId = created.json().user.id;
      const accessToken = created.json().auth.access_token.jwt;
      const refreshToken = created.json().auth.refresh_token.jwt;

      // valid access token -> 200 { user: { id, phone } }, no key material
      const ok = await app.inject({
        method: 'GET',
        url: '/v1/users/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ user: { id: userId, phone: PHONE_A } });
      expect(ok.body).not.toMatch(/PRIVATE KEY/);
      expect(ok.body).not.toMatch(/jwtPrivateKey/);

      // missing header -> 401
      const missing = await app.inject({ method: 'GET', url: '/v1/users/me' });
      expect(missing.statusCode).toBe(401);

      // refresh token used as an access token -> 401 (wrong type)
      const wrongType = await app.inject({
        method: 'GET',
        url: '/v1/users/me',
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      expect(wrongType.statusCode).toBe(401);

      // expired access token -> 401
      const expired = await app.inject({
        method: 'GET',
        url: '/v1/users/me',
        headers: { authorization: `Bearer ${await expiredAccessToken(userId)}` },
      });
      expect(expired.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

/**
 * Signs an already-expired access token for the given user with their stored
 * private key, so the authGuard's expiry branch is exercised through the real
 * ES256 verify path (backdated iat + short expiry -> exp in the past).
 */
async function expiredAccessToken(userId: string): Promise<string> {
  const repo = new UserRepository(harness.db);
  const user = await repo.findById(userId);
  if (!user) throw new Error('user not found while minting expired token');
  const iat = Math.floor(Date.now() / 1000) - 3600;
  return jwt.sign(
    { sub: userId, type: 'access', nonce: user.accessTokenNonce, iat, exp: iat + 60 },
    user.jwtPrivateKey,
    { algorithm: 'ES256' },
  );
}
