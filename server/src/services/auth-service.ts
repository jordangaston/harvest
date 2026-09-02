import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "../models/user.js";

const ACCESS_TTL: SignOptions["expiresIn"] = "15m";
const REFRESH_TTL: SignOptions["expiresIn"] = "30d";
const WEBLINK_TTL: SignOptions["expiresIn"] = "30d";

export interface Tokens {
  access_token: { jwt: string; expires_at: number };
  refresh_token: { jwt: string; expires_at: number };
}

type TokenType = "access" | "refresh" | "weblink";

// Owns sessions: a per-user ECDSA keypair signs ES256 access/refresh tokens.
// A `nonce` in each token, checked against the user row, allows revocation.
export class AuthService {
  /** Wire dependencies from the shared singletons. */
  static create() {
    return new AuthService();
  }

  /**
   * Generates a per-user P-256 (ES256) keypair, PEM-encoded.
   *
   * @returns The private key (pkcs8) and public key (spki).
   */
  generateKeyPair(): { privateKey: string; publicKey: string } {
    return crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }

  /**
   * Mints a fresh access + refresh token pair, each signed with the user's key.
   *
   * @param user - The user to mint the session for; supplies the signing key and nonces.
   * @returns The token pair with per-token expiry (unix seconds).
   */
  mintTokens(user: User): Tokens {
    return {
      access_token: this.sign(user, "access", ACCESS_TTL),
      refresh_token: this.sign(user, "refresh", REFRESH_TTL),
    };
  }

  /**
   * Mints a long-lived web-link token — the credential Chef embeds in an iMessage
   * link so a known user lands signed in on the web. Signed with the user's key,
   * revocable by bumping `webLinkNonce`.
   *
   * @param user - The user to mint the link for; supplies the signing key and nonce.
   * @param ttl - Expiry (defaults to 30 days); tests override to mint an expired token.
   * @returns The signed JWT and its expiry (unix seconds).
   */
  mintWebLink(user: User, ttl: SignOptions["expiresIn"] = WEBLINK_TTL): { jwt: string; expires_at: number } {
    return this.sign(user, "weblink", ttl);
  }

  /**
   * Verifies signature (ES256 only), expiry, and token type, returning the claims.
   *
   * @param token - The JWT to verify.
   * @param publicKey - The signer's public key (the named user's key).
   * @param type - The token type the caller expects.
   * @returns The subject and nonce claims.
   * @throws If the signature/expiry is invalid, or the token's type is not `type`.
   */
  verify(token: string, publicKey: string, type: TokenType): { sub: string; nonce: number } {
    const claims = jwt.verify(token, publicKey, { algorithms: ["ES256"] }) as {
      sub: string;
      type: TokenType;
      nonce: number;
    };
    if (claims.type !== type) throw new Error(`expected ${type} token`);
    return { sub: claims.sub, nonce: claims.nonce };
  }

  /**
   * Reads the `sub` claim without verifying — used to load the user whose key
   * then verifies the token. Never trust the result before that verify.
   *
   * @param token - The (unverified) JWT.
   * @returns The subject, or null if absent/undecodable.
   */
  decodeSub(token: string): string | null {
    const claims = jwt.decode(token) as { sub?: string } | null;
    return claims?.sub ?? null;
  }

  /**
   * Signs one token of the given type, embedding the user's matching nonce so it
   * can be revoked by bumping that nonce.
   *
   * @param user - Supplies the id (sub), signing key, and per-type nonce.
   * @param type - Which token to sign; selects the nonce.
   * @param ttl - Expiry, as a jsonwebtoken duration.
   * @returns The signed JWT and its expiry (unix seconds).
   */
  private sign(user: User, type: TokenType, ttl: SignOptions["expiresIn"]): { jwt: string; expires_at: number } {
    const nonce =
      type === "access" ? user.accessTokenNonce : type === "refresh" ? user.refreshTokenNonce : user.webLinkNonce;
    const token = jwt.sign({ sub: user.id, type, nonce }, user.jwtPrivateKey, {
      algorithm: "ES256",
      expiresIn: ttl,
    });
    const { exp } = jwt.decode(token) as { exp: number };
    return { jwt: token, expires_at: exp };
  }
}
