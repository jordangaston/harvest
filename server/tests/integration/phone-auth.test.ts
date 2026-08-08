import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../../src/db/index.js';
import { users, importJobs, recipes } from '../../src/db/schema/index.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import { buildApp } from '../../src/api/app.js';

const PHONE = '+15555550123';
const NAME = 'Jordan';
const GOOD_CODE = '123456';
const BAD_CODE = '000000';

let app: FastifyInstance;

beforeEach(async () => {
  await db.delete(importJobs); // FK dependents before users
  await db.delete(recipes);
  await db.delete(users);
  app = buildApp();
});
afterAll(async () => {
  await pool.end();
});

function createAccount() {
  return app.inject({
    method: 'POST',
    url: '/v1/users',
    payload: {
      user: {
        phone_number: PHONE,
        code: GOOD_CODE,
        name: NAME,
        onboarding: { age: 'from_25_to_34', goals: ['eat_healthier'] },
      },
    },
  });
}

describe('phone-auth (StubOtpProvider selected)', () => {
  it('sends an OTP', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/otps', payload: { otp: { phone_number: PHONE } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ otp: { status: 'pending' } });
  });

  it('rejects a malformed number with 400 naming phone_number', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/otps', payload: { otp: { phone_number: '12' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('phone_number');
  });

  it('verifies a good code and rejects a bad one, creating no user either way', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/otps/verify',
      payload: { otp: { phone_number: PHONE, code: GOOD_CODE } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ otp: { status: 'approved' } });

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/otps/verify',
      payload: { otp: { phone_number: PHONE, code: BAD_CODE } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_OTP');

    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('creates a new user for a verified phone (isNew, one row, no secrets)', async () => {
    const res = await createAccount();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isNew).toBe(true);
    expect(body.user).toEqual({ id: expect.any(String), phone: PHONE, name: NAME });
    expect(body.auth.access_token.jwt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY');

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(NAME);
    // C2: onboarding lands in typed enum columns + a completion stamp.
    expect(rows[0].age).toBe('from_25_to_34');
    expect(rows[0].goals).toEqual(['eat_healthier']);
    expect(rows[0].onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it('rejects account creation with a bad code and creates no user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: { user: { phone_number: PHONE, code: BAD_CODE, name: NAME } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_OTP');
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('signs in an existing user by OTP (isNew:false, same id)', async () => {
    const created = (await createAccount()).json();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users/sign_in',
      payload: { auth: { otp: { phone_number: PHONE, code: GOOD_CODE } } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isNew).toBe(false);
    expect(body.user.id).toBe(created.user.id);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('signs in by refresh token with no SMS; rejects a stale nonce', async () => {
    const created = (await createAccount()).json();
    const refresh = created.auth.refresh_token.jwt;

    const ok = await app.inject({ method: 'POST', url: '/v1/users/sign_in', payload: { auth: { refresh_token: refresh } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.id).toBe(created.user.id);

    await UserRepository.create().bumpNonce(created.user.id, 'refresh');
    const stale = await app.inject({ method: 'POST', url: '/v1/users/sign_in', payload: { auth: { refresh_token: refresh } } });
    expect(stale.statusCode).toBe(401);
  });

  it('guards /v1/users/me: valid access → 200, missing/refresh-as-access → 401', async () => {
    const created = (await createAccount()).json();
    const access = created.auth.access_token.jwt;

    const ok = await app.inject({ method: 'GET', url: '/v1/users/me', headers: { authorization: `Bearer ${access}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ user: { id: created.user.id, phone: PHONE, name: NAME } });

    expect((await app.inject({ method: 'GET', url: '/v1/users/me' })).statusCode).toBe(401);

    const asAccess = created.auth.refresh_token.jwt;
    const refreshRes = await app.inject({ method: 'GET', url: '/v1/users/me', headers: { authorization: `Bearer ${asAccess}` } });
    expect(refreshRes.statusCode).toBe(401);
  });
});
