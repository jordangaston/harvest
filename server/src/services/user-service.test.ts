import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from './user-service.js';
import { AuthService } from './auth-service.js';
import { OtpService } from './otp-service.js';
import { StubOtpProvider } from '../providers/otp-provider.js';
import type { UserRepository, CreateUserInput } from '../repositories/user-repository.js';
import type { Database } from '../db/index.js';
import type { User } from '../db/schema/users.js';
import { InvalidOtpError, RefreshInvalidError, UnauthorizedError } from '../errors.js';

/** In-memory UserRepository stub keyed by phone + id. `create` mints a keypair-
 * carrying row; the executor argument is ignored (there is no real tx). */
class StubUserRepository {
  private byPhone = new Map<string, User>();
  private byId = new Map<string, User>();
  private seq = 0;
  /** When set, the next create throws — simulates a mid-transaction DB fault. */
  public failNextCreate = false;

  async create(input: CreateUserInput): Promise<User> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('insert failed');
    }
    const row: User = {
      id: `00000000-0000-0000-0000-${String(++this.seq).padStart(12, '0')}`,
      phone: input.phone,
      jwtPrivateKey: input.jwtPrivateKey,
      jwtPublicKey: input.jwtPublicKey,
      accessTokenNonce: 0,
      refreshTokenNonce: 0,
      onboarding: input.onboarding ?? null,
      createdAt: new Date(),
    };
    this.byPhone.set(row.phone, row);
    this.byId.set(row.id, row);
    return row;
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    return this.byPhone.get(phone);
  }

  async findById(id: string): Promise<User | undefined> {
    return this.byId.get(id);
  }

  /** Test helper: revoke by bumping the in-memory refresh nonce. */
  bumpRefresh(id: string): void {
    const user = this.byId.get(id);
    if (user) user.refreshTokenNonce += 1;
  }
}

/** A fake Database whose transaction() runs the callback with a no-op executor
 * and propagates a thrown error (so a failed create rolls the "tx" back). */
function fakeDb(): Database {
  return {
    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      return cb({});
    },
  } as unknown as Database;
}

const PHONE_A = '+15555550123';
const PHONE_B = '+15555550999';

function build() {
  const provider = new StubOtpProvider();
  const otpService = new OtpService(provider);
  const authService = new AuthService();
  const repo = new StubUserRepository();
  const service = new UserService(
    fakeDb(),
    repo as unknown as UserRepository,
    authService,
    otpService,
  );
  return { provider, otpService, authService, repo, service };
}

describe('UserService (AC-3/5/6/7/10, TC-2/4/5/6)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('verifyAndResolve creates a new account and returns tokens + isNew (TC-2)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '123456');
    const result = await ctx.service.verifyAndResolve(PHONE_A, '123456', { age: '25-34' });

    expect(result.isNew).toBe(true);
    expect(result.user.phone).toBe(PHONE_A);
    expect(result.user.id).toBeTruthy();
    expect(result.auth.access_token.jwt).toBeTruthy();
    expect(result.auth.refresh_token.jwt).toBeTruthy();
    // no key material leaks into the public user
    expect(JSON.stringify(result.user)).not.toMatch(/PRIVATE KEY/);
    expect(result.user).not.toHaveProperty('jwtPrivateKey');
  });

  it('persists onboarding on create', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '123456');
    const result = await ctx.service.verifyAndResolve(PHONE_A, '123456', { age: '25-34' });
    const stored = await ctx.repo.findById(result.user.id);
    expect(stored?.onboarding).toEqual({ age: '25-34' });
  });

  it('rejects a bad OTP and creates no user (TC-3/AC-4)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '123456');
    await expect(ctx.service.verifyAndResolve(PHONE_A, '000000')).rejects.toBeInstanceOf(
      InvalidOtpError,
    );
    expect(await ctx.repo.findByPhone(PHONE_A)).toBeUndefined();
  });

  it('rolls back with no partial user on a DB fault, and a retry succeeds (TC-4/AC-5)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '123456');
    ctx.repo.failNextCreate = true;
    await expect(ctx.service.verifyAndResolve(PHONE_A, '123456')).rejects.toThrow('insert failed');
    expect(await ctx.repo.findByPhone(PHONE_A)).toBeUndefined();

    // a normal retry (fault cleared) now succeeds
    const retry = await ctx.service.verifyAndResolve(PHONE_A, '123456');
    expect(retry.isNew).toBe(true);
    expect(await ctx.repo.findByPhone(PHONE_A)).toBeDefined();
  });

  it('sign-in by OTP resolves existing vs brand-new (TC-5/AC-6)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '111111');
    ctx.provider.approvedCodes.set(PHONE_B, '222222');

    const first = await ctx.service.signIn({ otp: { phoneNumber: PHONE_A, code: '111111' } });
    expect(first.isNew).toBe(true);

    // A: existing -> same id, isNew false, no new row
    const again = await ctx.service.signIn({ otp: { phoneNumber: PHONE_A, code: '111111' } });
    expect(again.isNew).toBe(false);
    expect(again.user.id).toBe(first.user.id);

    // B: brand-new -> isNew true, distinct id
    const b = await ctx.service.signIn({ otp: { phoneNumber: PHONE_B, code: '222222' } });
    expect(b.isNew).toBe(true);
    expect(b.user.id).not.toBe(first.user.id);
  });

  it('sign-in by refresh token returns fresh tokens with no SMS (TC-6/AC-7)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '111111');
    const created = await ctx.service.verifyAndResolve(PHONE_A, '111111');
    const refresh = created.auth.refresh_token.jwt;

    const before = [...ctx.provider.sent];
    const signed = await ctx.service.signIn({ refreshToken: refresh });
    expect(signed.isNew).toBe(false);
    expect(signed.user.id).toBe(created.user.id);
    expect(signed.auth.access_token.jwt).toBeTruthy();
    // no send/check happened during the refresh path
    expect(ctx.provider.sent).toEqual(before);
  });

  it('rejects a refresh token with a stale nonce after revocation (TC-6/AC-7)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '111111');
    const created = await ctx.service.verifyAndResolve(PHONE_A, '111111');
    const refresh = created.auth.refresh_token.jwt;

    ctx.repo.bumpRefresh(created.user.id);
    await expect(ctx.service.signIn({ refreshToken: refresh })).rejects.toBeInstanceOf(
      RefreshInvalidError,
    );
  });

  it('rejects an access token used as a refresh token (wrong type)', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '111111');
    const created = await ctx.service.verifyAndResolve(PHONE_A, '111111');
    await expect(
      ctx.service.signIn({ refreshToken: created.auth.access_token.jwt }),
    ).rejects.toBeInstanceOf(RefreshInvalidError);
  });

  it('getMe returns {id, phone} only', async () => {
    ctx.provider.approvedCodes.set(PHONE_A, '111111');
    const created = await ctx.service.verifyAndResolve(PHONE_A, '111111');
    const me = await ctx.service.getMe(created.user.id);
    expect(me).toEqual({ user: { id: created.user.id, phone: PHONE_A } });
  });

  it('getMe throws for an unknown user', async () => {
    await expect(ctx.service.getMe('missing')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
