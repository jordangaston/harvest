import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { UserService } from '../../src/services/user-service.js';
import { OtpService } from '../../src/services/otp-service.js';
import { AuthService } from '../../src/services/auth-service.js';
import { StubOtpProvider } from '../../src/providers/otp-provider.js';
import { InvalidOtpError, RefreshInvalidError } from '../../src/api/errors.js';
import { UserSchema, type User } from '../../src/models/user.js';
import type { NewUser } from '../../src/db/schema/index.js';
import type { UserRepository } from '../../src/repositories/user-repository.js';

class FakeUserRepository {
  private readonly rows = new Map<string, User>();

  async findByPhone(phone: string): Promise<User | null> {
    return [...this.rows.values()].find((u) => u.phone === phone) ?? null;
  }
  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }
  async insert(values: NewUser): Promise<User> {
    // Drop undefined so the null defaults stand (drizzle ignores undefined too).
    const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    const user = UserSchema.parse({
      id: randomUUID(),
      name: null,
      accessTokenNonce: 0,
      refreshTokenNonce: 0,
      goals: null,
      recipeSources: null,
      cookDays: null,
      whenCook: null,
      cookTime: null,
      howHeard: null,
      age: null,
      onboardingCompletedAt: null,
      createdAt: new Date(),
      ...defined,
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
    const first = await service.createUser({
      phoneNumber: '+15555550123',
      code: '123456',
      name: 'Ada',
      onboarding: { age: 'from_25_to_34' },
    });
    expect(first.isNew).toBe(true);
    expect(first.user.name).toBe('Ada');
    expect(first.user.age).toBe('from_25_to_34');
    expect(first.user.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(auth.verify(first.tokens.access_token.jwt, first.user.jwtPublicKey, 'access').sub).toBe(first.user.id);

    const second = await service.createUser({ phoneNumber: '+15555550123', code: '123456', name: 'Ada' });
    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('signs in by OTP: good code resolves the user, bad code is rejected and provisions nothing', async () => {
    const created = await service.createUser({ phoneNumber: '+15555550123', code: '123456', name: 'Ada' });
    const signed = await service.signIn({ otp: { phone_number: '+15555550123', code: '123456' } });
    expect(signed.isNew).toBe(false);
    expect(signed.user.id).toBe(created.user.id);

    await expect(service.signIn({ otp: { phone_number: '+15555559999', code: '000000' } })).rejects.toBeInstanceOf(InvalidOtpError);
    expect(await repo.findByPhone('+15555559999')).toBeNull();
  });

  it('signs in by refresh token; rejects a stale nonce', async () => {
    const created = await service.createUser({ phoneNumber: '+15555550124', code: '123456', name: 'Ada' });
    const refreshed = await service.signIn({ refresh_token: created.tokens.refresh_token.jwt });
    expect(refreshed.user.id).toBe(created.user.id);

    await repo.bumpNonce(created.user.id, 'refresh');
    await expect(service.signIn({ refresh_token: created.tokens.refresh_token.jwt })).rejects.toBeInstanceOf(RefreshInvalidError);
  });

  it('getMe returns only public fields', async () => {
    const created = await service.createUser({ phoneNumber: '+15555550125', code: '123456', name: 'Ada' });
    expect(await service.getMe(created.user.id)).toEqual({ id: created.user.id, phone: '+15555550125', name: 'Ada' });
  });
});
