import { UserRepository } from '../repositories/user-repository.js';
import { AuthService, type Tokens } from './auth-service.js';
import { OtpService } from './otp-service.js';
import { normalizeE164 } from '../util/phone.js';
import { toPublicUser, type User } from '../models/user.js';
import { InvalidOtpError, RefreshInvalidError } from '../api/errors.js';

/** Create an account for an already-verified phone (verification happens
 * separately at POST /v1/otps/verify). */
export interface CreateUserRequest {
  phoneNumber: string;
  onboarding?: unknown;
}

/** Sign in an existing user — by refresh token or by OTP. */
export interface SignInRequest {
  otp?: { phone_number: string; code: string };
  refresh_token?: string;
}

/** A resolved user plus a freshly minted session. */
export interface Resolution {
  user: User;
  tokens: Tokens;
  isNew: boolean;
}

export class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  /** Wire dependencies from the shared singletons. */
  static create() {
    return new UserService(UserRepository.create(), AuthService.create(), OtpService.create());
  }

  /**
   * Creates (or returns the existing) user for an already-verified phone, with a session.
   *
   * @param req - The verified phone and optional onboarding payload.
   * @returns The user, a fresh session, and whether it was newly created.
   */
  async createUser(req: CreateUserRequest): Promise<Resolution> {
    const phone = normalizeE164(req.phoneNumber);
    const existing = await this.repo.findByPhone(phone);
    if (existing) return this.session(existing, false);
    return this.session(await this.provision(phone, req.onboarding), true);
  }

  /**
   * Signs in a user by refresh token, else by verified OTP.
   *
   * @param req - Exactly one of `refresh_token` or `otp`; refresh takes precedence.
   * @returns The resolved user and a fresh session.
   * @throws {RefreshInvalidError} If the refresh token doesn't resolve to a user.
   * @throws {InvalidOtpError} If the OTP code is wrong.
   */
  async signIn(req: SignInRequest): Promise<Resolution> {
    if (req.refresh_token) return this.resolveByRefreshToken(req.refresh_token);
    return this.signInByOtp(req.otp!);
  }

  /**
   * Authenticates a bearer access token against its owning user.
   *
   * @param token - The bearer access token.
   * @returns The user id, or null if the token is invalid/revoked.
   */
  async authenticateAccessToken(token: string): Promise<string | null> {
    const user = await this.userForToken(token, 'access');
    return user?.id ?? null;
  }

  /**
   * Fetches the public projection of the authenticated user.
   *
   * @param sub - The user id (a verified token's subject).
   * @returns The public user, or null if no such user.
   */
  getMe(sub: string): Promise<{ id: string; phone: string } | null> {
    return this.repo.findById(sub).then((user) => (user ? toPublicUser(user) : null));
  }

  /**
   * Verifies the OTP, then resolves (provisioning on first sign-in) the user.
   *
   * @param otp - The phone and code to verify.
   * @returns The resolved user and a fresh session; `isNew` on first sign-in.
   * @throws {InvalidOtpError} If the code is wrong.
   */
  private async signInByOtp(otp: { phone_number: string; code: string }): Promise<Resolution> {
    if (!(await this.otpService.verifyOtp(otp.phone_number, otp.code))) throw new InvalidOtpError();
    const phone = normalizeE164(otp.phone_number);
    const existing = await this.repo.findByPhone(phone);
    if (existing) return this.session(existing, false);
    return this.session(await this.provision(phone), true);
  }

  /**
   * Resolves a refresh token to its user and issues a new session.
   *
   * @param token - The refresh token.
   * @returns The user and a fresh session.
   * @throws {RefreshInvalidError} If the token is invalid, expired, or revoked.
   */
  private async resolveByRefreshToken(token: string): Promise<Resolution> {
    const user = await this.userForToken(token, 'refresh');
    if (!user) throw new RefreshInvalidError();
    return this.session(user, false);
  }

  /**
   * Loads the user a token names (via its unverified sub), then verifies the
   * token's signature, type, and nonce against that user's key. The single
   * place a token is resolved to its owner.
   *
   * @param token - The token to resolve.
   * @param type - Which token type to require; also selects the nonce compared.
   * @returns The owning user, or null on any failure (unknown user, bad
   *   signature, wrong type, or stale nonce).
   */
  private async userForToken(token: string, type: 'access' | 'refresh'): Promise<User | null> {
    const sub = this.authService.decodeSub(token);
    const user = sub && (await this.repo.findById(sub));
    if (!user) return null;
    try {
      const { nonce } = this.authService.verify(token, user.jwtPublicKey, type);
      const current = type === 'access' ? user.accessTokenNonce : user.refreshTokenNonce;
      return nonce === current ? user : null;
    } catch {
      return null;
    }
  }

  /**
   * Pairs a user with a freshly minted session.
   *
   * @param user - The resolved user.
   * @param isNew - Whether the user was just provisioned.
   * @returns The user, tokens, and `isNew` flag.
   */
  private session(user: User, isNew: boolean): Resolution {
    return { user, tokens: this.authService.mintTokens(user), isNew };
  }

  /**
   * Provisions a new user: generates their signing keypair and inserts the row.
   *
   * @param phone - E.164 phone; the caller must have normalized it.
   * @param onboarding - Optional onboarding payload to persist.
   * @returns The inserted user.
   */
  private async provision(phone: string, onboarding?: unknown): Promise<User> {
    const { privateKey, publicKey } = this.authService.generateKeyPair();
    return this.repo.insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, onboarding });
  }
}
