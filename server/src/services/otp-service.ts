import type { OtpProvider } from '../providers/otp-provider.js';
import { normalizeE164 } from '../util/phone.js';
import { InvalidOtpError } from '../errors.js';

/**
 * Coordinates OTP send/verify over an OtpProvider. Every phone number is
 * normalized to canonical E.164 first (AC-2/AC-9), so the provider and any
 * downstream lookup see one consistent key regardless of the caller's
 * formatting. `normalizeE164` throws `InvalidPhoneNumberError` for malformed
 * input before any provider call is made.
 */
export class OtpService {
  constructor(private readonly provider: OtpProvider) {}

  /**
   * Normalizes the number and asks the provider to send a code.
   *
   * @returns `{ status: 'pending' }` once delivery is initiated.
   * @throws {InvalidPhoneNumberError} If the number is not valid E.164 (no send
   *   is attempted).
   */
  async requestOtp(phoneNumber: string): Promise<{ status: 'pending' }> {
    const e164 = normalizeE164(phoneNumber);
    await this.provider.send(e164);
    return { status: 'pending' };
  }

  /**
   * Normalizes the number and checks the code with the provider.
   *
   * @returns The canonical E.164 number the code was approved for.
   * @throws {InvalidPhoneNumberError} If the number is not valid E.164.
   * @throws {InvalidOtpError} If the code is not approved.
   */
  async verifyOtp(phoneNumber: string, code: string): Promise<string> {
    const e164 = normalizeE164(phoneNumber);
    const approved = await this.provider.check(e164, code);
    if (!approved) throw new InvalidOtpError();
    return e164;
  }
}
