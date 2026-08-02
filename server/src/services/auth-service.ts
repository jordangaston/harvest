import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

/** A token's kind, embedded in its payload and checked on verify. */
export type TokenType = 'access' | 'refresh';

/** A signed JWT paired with its absolute expiry (Unix seconds, from `exp`). */
export interface IssuedToken {
  jwt: string;
  expires_at: number;
}

/** The access + refresh pair minted for a session. */
export interface TokenPair {
  access_token: IssuedToken;
  refresh_token: IssuedToken;
}

/** The verified/decoded payload of one of our session tokens. */
export interface TokenPayload extends jwt.JwtPayload {
  sub: string;
  type: TokenType;
  nonce: number;
}

/**
 * Issues and verifies the app's own ES256 session tokens using a per-user
 * ECDSA P-256 keypair stored on the user row. Access tokens live 15m, refresh
 * tokens 30d; each carries the user's `sub` (a uuid string), a `type`, and a
 * `nonce` so bumping the matching nonce on the user row revokes outstanding
 * tokens (AC-7/AC-10).
 */
export class AuthService {
  /** Generates a fresh PEM-encoded ECDSA P-256 keypair for a new user. */
  generateKeyPair(): { privateKey: string; publicKey: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { privateKey, publicKey };
  }

  /**
   * Signs a fresh access (15m) + refresh (30d) pair for the user, embedding the
   * given nonces. `userId` is the user's uuid `sub` — used verbatim, never
   * coerced to a number.
   */
  generateTokens(
    userId: string,
    privateKey: string,
    nonces: { access: number; refresh: number },
  ): TokenPair {
    const access = this.sign(userId, 'access', nonces.access, privateKey, ACCESS_TOKEN_TTL);
    const refresh = this.sign(userId, 'refresh', nonces.refresh, privateKey, REFRESH_TOKEN_TTL);
    return { access_token: access, refresh_token: refresh };
  }

  /**
   * Verifies a token against the user's public key and returns its payload.
   *
   * @throws {jwt.TokenExpiredError} If the token is expired.
   * @throws {jwt.JsonWebTokenError} If the signature is invalid or the token is
   *   malformed.
   */
  verifyToken(token: string, publicKey: string): TokenPayload {
    return jwt.verify(token, publicKey, { algorithms: ['ES256'] }) as TokenPayload;
  }

  /** Decodes a token without verifying it — used only to read `sub` before the
   * user's public key is known. Returns null on a malformed token. */
  decodeToken(token: string): TokenPayload | null {
    return jwt.decode(token) as TokenPayload | null;
  }

  private sign(
    userId: string,
    type: TokenType,
    nonce: number,
    privateKey: string,
    expiresIn: string,
  ): IssuedToken {
    const token = jwt.sign({ sub: userId, type, nonce }, privateKey, {
      algorithm: 'ES256',
      expiresIn,
    } as jwt.SignOptions);
    const { exp } = jwt.decode(token) as jwt.JwtPayload;
    return { jwt: token, expires_at: exp! };
  }
}
