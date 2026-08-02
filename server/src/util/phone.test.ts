import { describe, it, expect } from 'vitest';
import { normalizeE164, InvalidPhoneNumberError } from './phone.js';

describe('normalizeE164 (AC-2 / AC-9 / TC-1)', () => {
  it('collapses formatting differences to one canonical E.164', () => {
    const canonical = '+15555550123';
    expect(normalizeE164('+15555550123')).toBe(canonical);
    expect(normalizeE164('+1 (555) 555-0123')).toBe(canonical);
    expect(normalizeE164('+1 555-555-0123')).toBe(canonical);
    expect(normalizeE164('  +1 555 555 0123  ')).toBe(canonical);
  });

  it('normalizes an international number to E.164', () => {
    expect(normalizeE164('+44 7911 123456')).toBe('+447911123456');
  });

  it('rejects a too-short number', () => {
    expect(() => normalizeE164('12')).toThrow(InvalidPhoneNumberError);
  });

  it('rejects a number without a leading +', () => {
    expect(() => normalizeE164('5551234')).toThrow(InvalidPhoneNumberError);
  });

  it('rejects an empty string', () => {
    expect(() => normalizeE164('')).toThrow(InvalidPhoneNumberError);
  });

  it('rejects non-numeric junk', () => {
    expect(() => normalizeE164('notaphone')).toThrow(InvalidPhoneNumberError);
  });

  it('names the phone_number field on the thrown error', () => {
    try {
      normalizeE164('12');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPhoneNumberError);
      expect((error as InvalidPhoneNumberError).field).toBe('phone_number');
    }
  });
});
