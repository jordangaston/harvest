import { normalizeE164 } from "../util/phone.js";
import { selectOtpProvider, type OtpProvider } from "../providers/otp-provider.js";

export class OtpService {
  constructor(private readonly provider: OtpProvider) {}

  /** Wire dependencies from the shared singletons (Twilio live, or the stub offline). */
  static create() {
    return new OtpService(selectOtpProvider());
  }

  /**
   * Sends an OTP to the phone via the configured provider.
   *
   * @param rawPhone - Phone in any accepted format; normalized to E.164 first.
   * @throws If the phone can't be normalized to E.164.
   */
  async requestOtp(rawPhone: string): Promise<void> {
    await this.provider.send(normalizeE164(rawPhone));
  }

  /**
   * Checks a submitted OTP code against the phone.
   *
   * @param rawPhone - Phone in any accepted format; normalized to E.164 first.
   * @param code - The code the user entered.
   * @returns True if the code is valid.
   * @throws If the phone can't be normalized to E.164.
   */
  async verifyOtp(rawPhone: string, code: string): Promise<boolean> {
    return this.provider.check(normalizeE164(rawPhone), code);
  }
}
