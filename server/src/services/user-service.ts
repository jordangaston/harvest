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

  static create() {
    return new UserService(UserRepository.create(), AuthService.create(), OtpService.create());
  }

  /** Creates (or returns the existing) user for a verified phone, with a session. */
  async createUser(req: CreateUserRequest): Promise<Resolution> {
    const phone = normalizeE164(req.phoneNumber);
    const existing = await this.repo.findByPhone(phone);
    if (existing) return this.session(existing, false);
    return this.session(await this.provision(phone, req.onboarding), true);
  }

  /** Signs in a user by refresh token or by verified OTP. */
  async signIn(req: SignInRequest): Promise<Resolution> {
    if (req.refresh_token) return this.resolveByRefreshToken(req.refresh_token);
    return this.signInByOtp(req.otp!);
  }

  /** Authenticates a bearer access token against its user → the user id, or null. */
  async authenticateAccessToken(token: string): Promise<string | null> {
    const user = await this.userForToken(token, 'access');
    return user?.id ?? null;
  }

  getMe(sub: string): Promise<{ id: string; phone: string } | null> {
    return this.repo.findById(sub).then((user) => (user ? toPublicUser(user) : null));
  }

  private async signInByOtp(otp: { phone_number: string; code: string }): Promise<Resolution> {
    if (!(await this.otpService.verifyOtp(otp.phone_number, otp.code))) throw new InvalidOtpError();
    const phone = normalizeE164(otp.phone_number);
    const existing = await this.repo.findByPhone(phone);
    if (existing) return this.session(existing, false);
    return this.session(await this.provision(phone), true);
  }

  private async resolveByRefreshToken(token: string): Promise<Resolution> {
    const user = await this.userForToken(token, 'refresh');
    if (!user) throw new RefreshInvalidError();
    return this.session(user, false);
  }

  /** Loads the user a token names (via its unverified sub), then verifies the
   * token's signature, type, and nonce against that user's key. Null on any
   * failure — the single place a token is resolved to its owner. */
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

  private session(user: User, isNew: boolean): Resolution {
    return { user, tokens: this.authService.mintTokens(user), isNew };
  }

  private async provision(phone: string, onboarding?: unknown): Promise<User> {
    const { privateKey, publicKey } = this.authService.generateKeyPair();
    return this.repo.insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, onboarding });
  }
}
