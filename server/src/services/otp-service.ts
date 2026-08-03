import { normalizeE164 } from '../util/phone.js';
import { selectOtpProvider, type OtpProvider } from '../providers/otp-provider.js';

export class OtpService {
  constructor(private readonly provider: OtpProvider) {}

  static create() {
    return new OtpService(selectOtpProvider());
  }

  async requestOtp(rawPhone: string): Promise<void> {
    await this.provider.send(normalizeE164(rawPhone));
  }

  async verifyOtp(rawPhone: string, code: string): Promise<boolean> {
    return this.provider.check(normalizeE164(rawPhone), code);
  }
}
