import { describe, it, expect } from 'vitest';
import { StubOtpProvider } from './otp-provider.js';

describe('StubOtpProvider (AC-1 / TC-1)', () => {
  it('records each send in order and sends no SMS', async () => {
    const stub = new StubOtpProvider();
    await stub.send('+15555550123');
    await stub.send('+15555550999');
    expect(stub.sent).toEqual(['+15555550123', '+15555550999']);
  });

  it('approves only the preset code for a number', async () => {
    const stub = new StubOtpProvider();
    stub.approvedCodes.set('+15555550123', '123456');
    expect(await stub.check('+15555550123', '123456')).toBe(true);
    expect(await stub.check('+15555550123', '000000')).toBe(false);
  });

  it('rejects a code for a number with no preset', async () => {
    const stub = new StubOtpProvider();
    expect(await stub.check('+15555550123', '123456')).toBe(false);
  });
});
