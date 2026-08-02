import type { Database } from '../db/index.js';
import type { User } from '../db/schema/users.js';
import { UserRepository, type DbExecutor } from '../repositories/user-repository.js';
import { AuthService, type TokenPair } from './auth-service.js';
import { OtpService } from './otp-service.js';
import { RefreshInvalidError, UnauthorizedError } from '../errors.js';

/** The public user shape returned to clients — no key material (AC-10). */
export interface PublicUser {
  id: string;
  phone: string;
}

/** A resolved session: the user, a fresh token pair, and whether the account
 * was just created (lets the client route a new user into onboarding). */
export interface AuthResult {
  user: PublicUser;
  auth: TokenPair;
  isNew: boolean;
}

/** Sign-in credentials: exactly one of an OTP or a refresh token. */
export interface SignInInput {
  otp?: { phoneNumber: string; code: string };
  refreshToken?: string;
}

/**
 * Orchestrates phone-auth account resolution. It verifies OTPs, does an
 * idempotent find-or-create of a user keyed by E.164 phone, and mints our own
 * ES256 sessions. The OTP is verified *outside* the DB transaction so a Twilio
 * call never holds a row lock; the find-or-create + keypair provisioning run in
 * one transaction so a mid-write failure rolls back with no partial user
 * (AC-5).
 */
export class UserService {
  constructor(
    private readonly db: Database,
    private readonly userRepo: UserRepository,
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  /**
   * Verifies the OTP then find-or-creates the user, returning a session. Used
   * by `POST /v1/users` (create + verify).
   *
   * @throws {InvalidOtpError} If the code is not approved (before any DB write).
   * @throws {InvalidPhoneNumberError} If the number is malformed.
   */
  async verifyAndResolve(
    phoneNumber: string,
    code: string,
    onboarding?: unknown,
  ): Promise<AuthResult> {
    const e164 = await this.otpService.verifyOtp(phoneNumber, code);
    return this.findOrCreate(e164, onboarding);
  }

  /**
   * Resolves a user by OTP or refresh token and mints a fresh session. The OTP
   * path find-or-creates (F-02 4a: a verified new number becomes an account);
   * the refresh path never sends an SMS and never rotates nonces.
   *
   * @throws {RefreshInvalidError} If the refresh token is missing/malformed/
   *   wrong-type/expired/stale-nonce.
   */
  async signIn(input: SignInInput): Promise<AuthResult> {
    if (input.otp) {
      const e164 = await this.otpService.verifyOtp(input.otp.phoneNumber, input.otp.code);
      return this.findOrCreate(e164);
    }
    if (input.refreshToken) {
      const user = await this.resolveByRefreshToken(input.refreshToken);
      return { user: toPublicUser(user), auth: this.mint(user), isNew: false };
    }
    throw new RefreshInvalidError('An OTP or refresh token is required');
  }

  /**
   * Returns the authenticated user's public profile. Does not rotate tokens.
   *
   * @throws {UnauthorizedError} If the user no longer exists.
   */
  async getMe(userId: string): Promise<{ user: PublicUser }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new UnauthorizedError('User not found');
    return { user: toPublicUser(user) };
  }

  private async findOrCreate(e164: string, onboarding?: unknown): Promise<AuthResult> {
    const { user, isNew } = await this.db.transaction(async (tx) => {
      const executor = tx as unknown as DbExecutor;
      const existing = await this.userRepo.findByPhone(e164, executor);
      if (existing) return { user: existing, isNew: false };
      const { privateKey, publicKey } = this.authService.generateKeyPair();
      const created = await this.userRepo.create(
        { phone: e164, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, onboarding },
        executor,
      );
      return { user: created, isNew: true };
    });
    return { user: toPublicUser(user), auth: this.mint(user), isNew };
  }

  private async resolveByRefreshToken(token: string): Promise<User> {
    const decoded = this.authService.decodeToken(token);
    if (!decoded?.sub) throw new RefreshInvalidError();
    const user = await this.userRepo.findById(decoded.sub);
    if (!user) throw new RefreshInvalidError();

    let payload;
    try {
      payload = this.authService.verifyToken(token, user.jwtPublicKey);
    } catch {
      throw new RefreshInvalidError();
    }
    if (payload.type !== 'refresh') throw new RefreshInvalidError('Wrong token type');
    if (payload.nonce !== user.refreshTokenNonce) throw new RefreshInvalidError('Token revoked');
    return user;
  }

  private mint(user: User): TokenPair {
    return this.authService.generateTokens(user.id, user.jwtPrivateKey, {
      access: user.accessTokenNonce,
      refresh: user.refreshTokenNonce,
    });
  }
}

function toPublicUser(user: User): PublicUser {
  return { id: user.id, phone: user.phone };
}
