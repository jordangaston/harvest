import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { makeAuthGuard } from './auth-guard.js';
import { AuthService } from '../../services/auth-service.js';
import type { UserRepository } from '../../repositories/user-repository.js';
import type { User } from '../../db/schema/users.js';
import { UnauthorizedError } from '../../errors.js';

const auth = new AuthService();

function makeUser(): User {
  const { privateKey, publicKey } = auth.generateKeyPair();
  return {
    id: '11111111-2222-3333-4444-555555555555',
    phone: '+15555550123',
    jwtPrivateKey: privateKey,
    jwtPublicKey: publicKey,
    accessTokenNonce: 0,
    refreshTokenNonce: 0,
    onboarding: null,
    createdAt: new Date(),
  };
}

function repoWith(user: User | undefined): UserRepository {
  return {
    async findById(id: string) {
      return user && user.id === id ? user : undefined;
    },
  } as unknown as UserRepository;
}

function req(headers: Record<string, string> = {}): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}
const reply = {} as FastifyReply;

/** Invokes the preHandler with a dummy Fastify `this`, matching how Fastify
 * binds route hooks — so the test calls the hook exactly as production does. */
function run(guard: preHandlerAsyncHookHandler, request: FastifyRequest): Promise<unknown> {
  return guard.call({} as unknown as FastifyInstance, request, reply);
}

describe('authGuard (AC-8 / TC-7)', () => {
  let user: User;
  beforeEach(() => {
    user = makeUser();
  });

  it('sets authUserId for a valid access token', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    const { access_token } = auth.generateTokens(user.id, user.jwtPrivateKey, {
      access: 0,
      refresh: 0,
    });
    const request = req({ authorization: `Bearer ${access_token.jwt}` });
    await run(guard, request);
    expect(request.authUserId).toBe(user.id);
  });

  it('rejects a missing Authorization header', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    await expect(run(guard, req())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a non-Bearer header', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    await expect(run(guard, req({ authorization: 'Basic abc' }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects a refresh token used as an access token', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    const { refresh_token } = auth.generateTokens(user.id, user.jwtPrivateKey, {
      access: 0,
      refresh: 0,
    });
    await expect(
      run(guard, req({ authorization: `Bearer ${refresh_token.jwt}` })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an expired access token', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    const expired = jwt.sign({ sub: user.id, type: 'access', nonce: 0 }, user.jwtPrivateKey, {
      algorithm: 'ES256',
      expiresIn: -10,
    });
    await expect(run(guard, req({ authorization: `Bearer ${expired}` }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects a token whose nonce is stale (revoked)', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    // token minted at nonce 0, but the user's access nonce has since bumped to 1
    const { access_token } = auth.generateTokens(user.id, user.jwtPrivateKey, {
      access: 0,
      refresh: 0,
    });
    user.accessTokenNonce = 1;
    await expect(
      run(guard, req({ authorization: `Bearer ${access_token.jwt}` })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects when the user no longer exists', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(undefined) });
    const { access_token } = auth.generateTokens(user.id, user.jwtPrivateKey, {
      access: 0,
      refresh: 0,
    });
    await expect(
      run(guard, req({ authorization: `Bearer ${access_token.jwt}` })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token signed by a different key', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    const other = auth.generateKeyPair();
    const { access_token } = auth.generateTokens(user.id, other.privateKey, {
      access: 0,
      refresh: 0,
    });
    await expect(
      run(guard, req({ authorization: `Bearer ${access_token.jwt}` })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects garbage in the Bearer slot', async () => {
    const guard = makeAuthGuard({ authService: auth, userRepo: repoWith(user) });
    await expect(
      run(guard, req({ authorization: 'Bearer not-a-jwt' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
