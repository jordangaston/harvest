import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { UserService } from '../../src/services/user-service.js';
import { OtpService } from '../../src/services/otp-service.js';
import { AuthService } from '../../src/services/auth-service.js';
import { StubOtpProvider } from '../../src/providers/otp-provider.js';
import { InvalidOtpError, RefreshInvalidError } from '../../src/api/errors.js';
import { UserSchema, type User } from '../../src/models/user.js';
import type { UserRepository } from '../../src/repositories/user-repository.js';

class FakeUserRepository {
  private readonly rows = new Map<string, User>();

  async findByPhone(phone: string): Promise<User | null> {
    return [...this.rows.values()].find((u) => u.phone === phone) ?? null;
  }
  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }
  async insert(values: { phone: string; jwtPrivateKey: string; jwtPublicKey: string; onboarding?: unknown }): Promise<User> {
    const user = UserSchema.parse({
      id: randomUUID(),
      phone: values.phone,
      jwtPrivateKey: values.jwtPrivateKey,
      jwtPublicKey: values.jwtPublicKey,
      accessTokenNonce: 0,
      refreshTokenNonce: 0,
      onboarding: values.onboarding ?? null,
      createdAt: new Date(),
    });
    this.rows.set(user.id, user);
    return user;
  }
  async bumpNonce(id: string, kind: 'access' | 'refresh'): Promise<void> {
    const user = this.rows.get(id)!;
    const key = kind === 'access' ? 'accessTokenNonce' : 'refreshTokenNonce';
    this.rows.set(id, { ...user, [key]: user[key] + 1 });
  }
}

const auth = AuthService.create();
let repo: FakeUserRepository;
let service: UserService;

function build(): UserService {
  repo = new FakeUserRepository();
  const otp = new OtpService(new StubOtpProvider());
  return new UserService(repo as unknown as UserRepository, auth, otp);
}

beforeEach(() => {
  service = build();
});

describe('UserService', () => {
  it('creates a new user (isNew) then reuses it for the same phone (not new)', async () => {
    const first = await service.createUser({ phoneNumber: '+15555550123', onboarding: { age: '25-34' } });
    expect(first.isNew).toBe(true);
    expect(first.user.onboarding).toEqual({ age: '25-34' });
    expect(auth.verify(first.tokens.access_token.jwt, first.user.jwtPublicKey, 'access').sub).toBe(first.user.id);

    const second = await service.createUser({ phoneNumber: '+15555550123' });
    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('signs in by OTP: good code resolves the user, bad code is rejected and provisions nothing', async () => {
    const created = await service.createUser({ phoneNumber: '+15555550123' });
    const signed = await service.signIn({ otp: { phone_number: '+15555550123', code: '123456' } });
    expect(signed.isNew).toBe(false);
    expect(signed.user.id).toBe(created.user.id);

    await expect(service.signIn({ otp: { phone_number: '+15555559999', code: '000000' } })).rejects.toBeInstanceOf(InvalidOtpError);
    expect(await repo.findByPhone('+15555559999')).toBeNull();
  });

  it('signs in by refresh token; rejects a stale nonce', async () => {
    const created = await service.createUser({ phoneNumber: '+15555550124' });
    const refreshed = await service.signIn({ refresh_token: created.tokens.refresh_token.jwt });
    expect(refreshed.user.id).toBe(created.user.id);

    await repo.bumpNonce(created.user.id, 'refresh');
    await expect(service.signIn({ refresh_token: created.tokens.refresh_token.jwt })).rejects.toBeInstanceOf(RefreshInvalidError);
  });

  it('getMe returns only public fields', async () => {
    const created = await service.createUser({ phoneNumber: '+15555550125' });
    expect(await service.getMe(created.user.id)).toEqual({ id: created.user.id, phone: '+15555550125' });
  });
});
