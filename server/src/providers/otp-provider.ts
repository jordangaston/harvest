/**
 * Delivery + verification of a one-time SMS code, behind an interface so the
 * composition root can select Twilio Verify in production and a stub in
 * dev/tests (no SMS, no spend, no network — AC-1). Callers pass canonical E.164
 * numbers; normalization happens upstream in OtpService.
 */
export interface OtpProvider {
  /** Initiates OTP delivery to an E.164 number. */
  send(phoneNumber: string): Promise<void>;
  /** Returns true iff the code is approved for the E.164 number. */
  check(phoneNumber: string, code: string): Promise<boolean>;
}

/**
 * In-memory OtpProvider for dev and tests: records every send and approves a
 * code only when it matches the number's preset entry. No SMS is sent.
 */
export class StubOtpProvider implements OtpProvider {
  /** Every number `send` was called with, in order (assertable in tests). */
  public readonly sent: string[] = [];
  /** Preset phone → approved-code map; seed it before calling `check`. */
  public readonly approvedCodes = new Map<string, string>();

  async send(phoneNumber: string): Promise<void> {
    this.sent.push(phoneNumber);
  }

  async check(phoneNumber: string, code: string): Promise<boolean> {
    return this.approvedCodes.get(phoneNumber) === code;
  }
}

/** Structural type for Twilio Verify's `verifications` resource. */
export interface TwilioVerificationsClient {
  create(opts: { to: string; channel: string }): Promise<unknown>;
}

/** Structural type for Twilio Verify's `verificationChecks` resource. */
export interface TwilioVerificationChecksClient {
  create(opts: { to: string; code: string }): Promise<{ status: string }>;
}

/** Structural type for a Twilio Verify service (`client.verify.v2.services(sid)`). */
export interface TwilioVerifyServiceClient {
  verifications: TwilioVerificationsClient;
  verificationChecks: TwilioVerificationChecksClient;
}

/**
 * Twilio Verify-backed OtpProvider for production. Takes the service resource
 * (`client.verify.v2.services(serviceSid)`) so the SDK client is constructed in
 * the composition root and this class stays unit-testable against a structural
 * stub. Verification succeeds when Twilio returns `status === 'approved'`.
 */
export class TwilioVerifyOtpProvider implements OtpProvider {
  constructor(private readonly service: TwilioVerifyServiceClient) {}

  async send(phoneNumber: string): Promise<void> {
    await this.service.verifications.create({ to: phoneNumber, channel: 'sms' });
  }

  async check(phoneNumber: string, code: string): Promise<boolean> {
    const result = await this.service.verificationChecks.create({ to: phoneNumber, code });
    return result.status === 'approved';
  }
}
