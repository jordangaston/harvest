import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { AuthService } from './auth-service.js';

const USER_ID = '11111111-2222-3333-4444-555555555555';

function svc() {
  return new AuthService();
}

describe('AuthService crypto (AC-7 / AC-10 / TC-8)', () => {
  it('generates a PEM ECDSA P-256 keypair', () => {
    const { privateKey, publicKey } = svc().generateKeyPair();
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
    expect(publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('round-trips access + refresh tokens against the public key', () => {
    const auth = svc();
    const { privateKey, publicKey } = auth.generateKeyPair();
    const tokens = auth.generateTokens(USER_ID, privateKey, { access: 0, refresh: 0 });

    const access = auth.verifyToken(tokens.access_token.jwt, publicKey);
    const refresh = auth.verifyToken(tokens.refresh_token.jwt, publicKey);

    expect(access.sub).toBe(USER_ID);
    expect(access.type).toBe('access');
    expect(refresh.type).toBe('refresh');
  });

  it('uses the uuid sub verbatim (never coerced to a number)', () => {
    const auth = svc();
    const { privateKey, publicKey } = auth.generateKeyPair();
    const { access_token } = auth.generateTokens(USER_ID, privateKey, { access: 0, refresh: 0 });
    expect(auth.verifyToken(access_token.jwt, publicKey).sub).toBe(USER_ID);
  });

  it('embeds the supplied nonces', () => {
    const auth = svc();
    const { privateKey, publicKey } = auth.generateKeyPair();
    const tokens = auth.generateTokens(USER_ID, privateKey, { access: 7, refresh: 9 });
    expect(auth.verifyToken(tokens.access_token.jwt, publicKey).nonce).toBe(7);
    expect(auth.verifyToken(tokens.refresh_token.jwt, publicKey).nonce).toBe(9);
  });

  it('fails to verify a token signed by a different key', () => {
    const auth = svc();
    const a = auth.generateKeyPair();
    const b = auth.generateKeyPair();
    const { access_token } = auth.generateTokens(USER_ID, a.privateKey, { access: 0, refresh: 0 });
    expect(() => auth.verifyToken(access_token.jwt, b.publicKey)).toThrow();
  });

  it('fails to verify a tampered token', () => {
    const auth = svc();
    const { privateKey, publicKey } = auth.generateKeyPair();
    const { access_token } = auth.generateTokens(USER_ID, privateKey, { access: 0, refresh: 0 });
    const [h, p, s] = access_token.jwt.split('.');
    // Flip a character in the signature segment: the payload still decodes but
    // the ES256 signature no longer matches -> invalid-signature rejection.
    const tampered = [h, p, s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')].join('.');
    expect(() => auth.verifyToken(tampered, publicKey)).toThrow(jwt.JsonWebTokenError);
  });

  it('surfaces type on the payload so callers can reject the wrong type', () => {
    const auth = svc();
    const { privateKey, publicKey } = auth.generateKeyPair();
    const { access_token } = auth.generateTokens(USER_ID, privateKey, { access: 0, refresh: 0 });
    // An access token verifies fine, but its type is 'access' — a caller
    // expecting a refresh token must reject it on this field.
    expect(auth.verifyToken(access_token.jwt, publicKey).type).not.toBe('refresh');
  });

  it('throws TokenExpiredError for an expired token', () => {
    const auth = svc();
    const { privateKey, publicKey } = auth.generateKeyPair();
    const expired = jwt.sign({ sub: USER_ID, type: 'access', nonce: 0 }, privateKey, {
      algorithm: 'ES256',
      expiresIn: -10,
    });
    expect(() => auth.verifyToken(expired, publicKey)).toThrow(jwt.TokenExpiredError);
  });

  it('sets exp ~15m for access and ~30d for refresh (seconds)', () => {
    const auth = svc();
    const { privateKey } = auth.generateKeyPair();
    const tokens = auth.generateTokens(USER_ID, privateKey, { access: 0, refresh: 0 });
    const access = jwt.decode(tokens.access_token.jwt) as jwt.JwtPayload;
    const refresh = jwt.decode(tokens.refresh_token.jwt) as jwt.JwtPayload;
    expect(access.exp! - access.iat!).toBe(15 * 60);
    expect(refresh.exp! - refresh.iat!).toBe(30 * 24 * 60 * 60);
    expect(tokens.access_token.expires_at).toBe(access.exp);
    expect(tokens.refresh_token.expires_at).toBe(refresh.exp);
  });
});
