import { describe, it, expect } from 'vitest';
import { StubOtpProvider } from '../../src/providers/otp-provider.js';

describe('StubOtpProvider', () => {
  it('records sends and approves only the fixed code', async () => {
    const stub = new StubOtpProvider();
    await stub.send('+15555550123');
    expect(stub.sends).toEqual(['+15555550123']);
    expect(await stub.check('+15555550123', '123456')).toBe(true);
    expect(await stub.check('+15555550123', '000000')).toBe(false);
  });
});
