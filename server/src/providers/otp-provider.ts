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

  static create(): TwilioVerifyOtpProvider {
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    return new TwilioVerifyOtpProvider(client, env.TWILIO_VERIFY_SERVICE_SID!);
  }

  async send(e164: string): Promise<void> {
    await this.client.verify.v2.services(this.serviceSid).verifications.create({ to: e164, channel: 'sms' });
  }

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

  async send(e164: string): Promise<void> {
    this.sends.push(e164);
  }

  async check(_e164: string, code: string): Promise<boolean> {
    return code === StubOtpProvider.VALID_CODE;
  }
}

export function selectOtpProvider(): OtpProvider {
  const configured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID;
  return configured ? TwilioVerifyOtpProvider.create() : new StubOtpProvider();
}
