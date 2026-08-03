import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AuthService } from '../../src/services/auth-service.js';
import type { User } from '../../src/models/user.js';

const auth = AuthService.create();

function makeUser(): User {
  const { privateKey, publicKey } = auth.generateKeyPair();
  return {
    id: randomUUID(),
    phone: '+15555550000',
    jwtPrivateKey: privateKey,
    jwtPublicKey: publicKey,
    accessTokenNonce: 0,
    refreshTokenNonce: 0,
    onboarding: null,
    createdAt: new Date(),
  };
}

describe('AuthService', () => {
  it('mints ES256 tokens that verify against the user public key', () => {
    const user = makeUser();
    const { access_token, refresh_token } = auth.mintTokens(user);
    expect(auth.verify(access_token.jwt, user.jwtPublicKey, 'access').sub).toBe(user.id);
    expect(auth.verify(refresh_token.jwt, user.jwtPublicKey, 'refresh').nonce).toBe(0);
  });

  it('rejects wrong type, tampering, HS256 confusion, and alg:none', () => {
    const user = makeUser();
    const { access_token } = auth.mintTokens(user);
    expect(() => auth.verify(access_token.jwt, user.jwtPublicKey, 'refresh')).toThrow();
    expect(() => auth.verify(access_token.jwt + 'x', user.jwtPublicKey, 'access')).toThrow();

    const hsForged = jwt.sign({ sub: user.id, type: 'access', nonce: 0 }, user.jwtPublicKey, {
      algorithm: 'HS256',
    });
    expect(() => auth.verify(hsForged, user.jwtPublicKey, 'access')).toThrow();

    const unsigned = jwt.sign({ sub: user.id, type: 'access', nonce: 0 }, null, { algorithm: 'none' });
    expect(() => auth.verify(unsigned, user.jwtPublicKey, 'access')).toThrow();
  });

  it('access ~15m, refresh ~30d', () => {
    const now = Math.floor(Date.now() / 1000);
    const { access_token, refresh_token } = auth.mintTokens(makeUser());
    expect(access_token.expires_at - now).toBeGreaterThan(14 * 60);
    expect(access_token.expires_at - now).toBeLessThan(16 * 60);
    expect(refresh_token.expires_at - now).toBeGreaterThan(29 * 24 * 3600);
  });
});
