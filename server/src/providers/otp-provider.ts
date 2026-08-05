import twilio, { type Twilio } from 'twilio';
import { env } from '../config/env.js';

export interface OtpProvider {
  send(e164: string): Promise<void>;
  check(e164: string, code: string): Promise<boolean>;
}

// Twilio Verify: we never store codes; Twilio owns the OTP lifecycle (NFR-05).
export class TwilioVerifyOtpProvider implements OtpProvider {
  constructor(
    private readonly client: Twilio,
    private readonly serviceSid: string,
  ) {}

  /**
   * Wire dependencies from the shared singletons.
   *
   * @returns A provider bound to the configured Twilio Verify service.
   */
  static create(): TwilioVerifyOtpProvider {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    return new TwilioVerifyOtpProvider(client, env.TWILIO_VERIFY_SERVICE_SID!);
  }

  /**
   * Starts a Twilio Verify SMS verification for the number.
   *
   * @param e164 - The recipient in E.164 form.
   */
  async send(e164: string): Promise<void> {
    await this.client.verify.v2.services(this.serviceSid).verifications.create({ to: e164, channel: 'sms' });
  }

  /**
   * Checks a code against Twilio Verify.
   *
   * @param e164 - The number the code was sent to, E.164.
   * @param code - The code the user entered.
   * @returns True when Twilio reports the check `approved`.
   */
  async check(e164: string, code: string): Promise<boolean> {
    const result = await this.client.verify.v2
      .services(this.serviceSid)
      .verificationChecks.create({ to: e164, code });
    return result.status === 'approved';
  }
}

// Dev/test provider: no SMS, no cost. Approves a single fixed code.
export class StubOtpProvider implements OtpProvider {
  static readonly VALID_CODE = '123456';
  readonly sends: string[] = [];

  /**
   * Records the send instead of texting; no SMS, no cost.
   *
   * @param e164 - The number that would have been texted; appended to `sends`.
   */
  async send(e164: string): Promise<void> {
    this.sends.push(e164);
  }

  /**
   * Approves only the fixed {@link StubOtpProvider.VALID_CODE}.
   *
   * @param _e164 - Ignored; the stub is phone-agnostic.
   * @param code - The code the user entered.
   * @returns True iff `code` equals the fixed valid code.
   */
  async check(_e164: string, code: string): Promise<boolean> {
    return code === StubOtpProvider.VALID_CODE;
  }
}

/**
 * Selects the live Twilio provider when fully configured, else the offline stub.
 *
 * @returns The Twilio provider if all three Twilio env vars are set, else the stub.
 */
export function selectOtpProvider(): OtpProvider {
  const configured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID;
  return configured ? TwilioVerifyOtpProvider.create() : new StubOtpProvider();
}
