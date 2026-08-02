import { describe, it, expect } from 'vitest';
import { toErrorReply } from './errors.js';
import {
  InvalidOtpError,
  RefreshInvalidError,
  OtpRequestFailedError,
  UnauthorizedError,
} from '../errors.js';
import { InvalidPhoneNumberError } from '../util/phone.js';
import { createUserBody, signInBody, sendOtpBody } from './schemas.js';

describe('toErrorReply (AC-2/4/7)', () => {
  it('maps InvalidOtpError to 400 INVALID_OTP', () => {
    const { status, body } = toErrorReply(new InvalidOtpError());
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_OTP');
  });

  it('maps RefreshInvalidError to 401 REFRESH_INVALID', () => {
    const { status, body } = toErrorReply(new RefreshInvalidError());
    expect(status).toBe(401);
    expect(body.error.code).toBe('REFRESH_INVALID');
  });

  it('maps OtpRequestFailedError to OTP_REQUEST_FAILED', () => {
    expect(toErrorReply(new OtpRequestFailedError()).body.error.code).toBe('OTP_REQUEST_FAILED');
  });

  it('maps UnauthorizedError to 401', () => {
    expect(toErrorReply(new UnauthorizedError()).status).toBe(401);
  });

  it('maps a malformed phone to 400 naming phone_number', () => {
    const { status, body } = toErrorReply(new InvalidPhoneNumberError());
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PHONE_NUMBER');
    expect(body.error.message).toMatch(/phone_number/);
  });

  it('maps a Zod validation error to 400 without leaking internals', () => {
    const parsed = createUserBody.safeParse({ user: { phone_number: '+1555', code: '' } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const { status, body } = toErrorReply(parsed.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('maps an unknown error to an opaque 500', () => {
    const { status, body } = toErrorReply(new Error('secret key material leaked'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toMatch(/secret/);
  });
});

describe('request schemas', () => {
  it('accepts a valid send-otp body', () => {
    expect(sendOtpBody.safeParse({ otp: { phone_number: '+15555550123' } }).success).toBe(true);
  });

  it('rejects an empty phone_number', () => {
    expect(sendOtpBody.safeParse({ otp: { phone_number: '' } }).success).toBe(false);
  });

  it('accepts a create-user body with optional onboarding', () => {
    expect(
      createUserBody.safeParse({
        user: { phone_number: '+15555550123', code: '123456', onboarding: { age: '25-34' } },
      }).success,
    ).toBe(true);
  });

  it('sign_in requires exactly one of otp or refresh_token', () => {
    expect(signInBody.safeParse({ auth: { refresh_token: 'x' } }).success).toBe(true);
    expect(
      signInBody.safeParse({ auth: { otp: { phone_number: '+15555550123', code: '1' } } }).success,
    ).toBe(true);
    expect(signInBody.safeParse({ auth: {} }).success).toBe(false);
    expect(
      signInBody.safeParse({
        auth: { refresh_token: 'x', otp: { phone_number: '+15555550123', code: '1' } },
      }).success,
    ).toBe(false);
  });
});
