import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { User } from '../models/user.js';

const ACCESS_TTL: SignOptions['expiresIn'] = '15m';
const REFRESH_TTL: SignOptions['expiresIn'] = '30d';

export interface Tokens {
  access_token: { jwt: string; expires_at: number };
  refresh_token: { jwt: string; expires_at: number };
}

type TokenType = 'access' | 'refresh';

// Owns sessions: a per-user ECDSA keypair signs ES256 access/refresh tokens.
// A `nonce` in each token, checked against the user row, allows revocation.
export class AuthService {
  static create() {
    return new AuthService();
  }

  generateKeyPair(): { privateKey: string; publicKey: string } {
    return crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  }

  mintTokens(user: User): Tokens {
    return {
      access_token: this.sign(user, 'access', ACCESS_TTL),
      refresh_token: this.sign(user, 'refresh', REFRESH_TTL),
    };
  }

  /** Verifies signature (ES256 only), expiry, and token type. Returns the claims. */
  verify(token: string, publicKey: string, type: TokenType): { sub: string; nonce: number } {
    const claims = jwt.verify(token, publicKey, { algorithms: ['ES256'] }) as {
      sub: string;
      type: TokenType;
      nonce: number;
    };
    if (claims.type !== type) throw new Error(`expected ${type} token`);
    return { sub: claims.sub, nonce: claims.nonce };
  }

  /** The `sub` without verifying — used to load the user whose key then verifies the token. */
  decodeSub(token: string): string | null {
    const claims = jwt.decode(token) as { sub?: string } | null;
    return claims?.sub ?? null;
  }

  private sign(user: User, type: TokenType, ttl: SignOptions['expiresIn']): { jwt: string; expires_at: number } {
    const nonce = type === 'access' ? user.accessTokenNonce : user.refreshTokenNonce;
    const token = jwt.sign({ sub: user.id, type, nonce }, user.jwtPrivateKey, {
      algorithm: 'ES256',
      expiresIn: ttl,
    });
    const { exp } = jwt.decode(token) as { exp: number };
    return { jwt: token, expires_at: exp };
  }
}
