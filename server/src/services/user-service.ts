import { UserRepository } from '../repositories/user-repository.js';
import { AuthService, type Tokens } from './auth-service.js';
import { OtpService } from './otp-service.js';
import { normalizeE164 } from '../util/phone.js';
import { toPublicUser, type User } from '../models/user.js';
import { InvalidOtpError, RefreshInvalidError } from '../api/errors.js';

interface Resolution {
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

  async verifyAndResolve(input: { phone: string; code: string; onboarding?: unknown }): Promise<Resolution> {
    if (!(await this.otpService.verifyOtp(input.phone, input.code))) throw new InvalidOtpError();
    const phone = normalizeE164(input.phone);
    const existing = await this.repo.findByPhone(phone);
    if (existing) return { user: existing, tokens: this.authService.mintTokens(existing), isNew: false };
    const user = await this.provision(phone, input.onboarding);
    return { user, tokens: this.authService.mintTokens(user), isNew: true };
  }

  async signIn(input: { otp?: { phone_number: string; code: string }; refresh_token?: string }): Promise<Resolution> {
    if (input.otp) return this.verifyAndResolve({ phone: input.otp.phone_number, code: input.otp.code });
    return this.resolveByRefreshToken(input.refresh_token!);
  }

  getMe(sub: string): Promise<{ id: string; phone: string } | null> {
    return this.repo.findById(sub).then((user) => (user ? toPublicUser(user) : null));
  }

  private async provision(phone: string, onboarding?: unknown): Promise<User> {
    const { privateKey, publicKey } = this.authService.generateKeyPair();
    return this.repo.insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey, onboarding });
  }

  private async resolveByRefreshToken(token: string): Promise<Resolution> {
    const sub = this.authService.decodeSub(token);
    const user = sub && (await this.repo.findById(sub));
    if (!user) throw new RefreshInvalidError();
    try {
      const { nonce } = this.authService.verify(token, user.jwtPublicKey, 'refresh');
      if (nonce !== user.refreshTokenNonce) throw new RefreshInvalidError();
    } catch {
      throw new RefreshInvalidError();
    }
    return { user, tokens: this.authService.mintTokens(user), isNew: false };
  }
}
