import { describe, it, expect } from 'vitest';
import { OtpService } from './otp-service.js';
import { StubOtpProvider } from '../providers/otp-provider.js';
import { InvalidOtpError } from '../errors.js';
import { InvalidPhoneNumberError } from '../util/phone.js';

function make() {
  const provider = new StubOtpProvider();
  return { provider, service: new OtpService(provider) };
}

describe('OtpService (AC-2/4, TC-1/3)', () => {
  it('normalizes then sends, returning pending', async () => {
    const { provider, service } = make();
    const result = await service.requestOtp('+1 (555) 555-0123');
    expect(result).toEqual({ status: 'pending' });
    expect(provider.sent).toEqual(['+15555550123']);
  });

  it('rejects a malformed number without calling the provider', async () => {
    const { provider, service } = make();
    await expect(service.requestOtp('12')).rejects.toBeInstanceOf(InvalidPhoneNumberError);
    expect(provider.sent).toEqual([]);
  });

  it('verifies an approved code and returns canonical E.164', async () => {
    const { provider, service } = make();
    provider.approvedCodes.set('+15555550123', '123456');
    // Caller passes a differently-formatted number; verify still resolves it.
    await expect(service.verifyOtp('+1 555-555-0123', '123456')).resolves.toBe('+15555550123');
  });

  it('throws InvalidOtpError on an unapproved code', async () => {
    const { provider, service } = make();
    provider.approvedCodes.set('+15555550123', '123456');
    await expect(service.verifyOtp('+15555550123', '000000')).rejects.toBeInstanceOf(
      InvalidOtpError,
    );
  });

  it('rejects a malformed number on verify before checking the code', async () => {
    const { service } = make();
    await expect(service.verifyOtp('12', '123456')).rejects.toBeInstanceOf(
      InvalidPhoneNumberError,
    );
  });
});
