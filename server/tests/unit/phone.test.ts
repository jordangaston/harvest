import { describe, it, expect } from 'vitest';
import { normalizeE164, InvalidPhoneError } from '../../src/util/phone.js';

describe('normalizeE164', () => {
  it('returns canonical E.164 for a valid full number', () => {
    expect(normalizeE164('+1 (555) 555-0123')).toBe('+15555550123');
  });

  it('throws InvalidPhoneError for malformed or region-less input', () => {
    expect(() => normalizeE164('12')).toThrow(InvalidPhoneError);
    expect(() => normalizeE164('5555550123')).toThrow(InvalidPhoneError);
  });
});
