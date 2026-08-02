import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Thrown when a phone number cannot be parsed as a full E.164 number. Carries
 * the field name so the API layer can surface a 400 naming `phone_number`.
 */
export class InvalidPhoneNumberError extends Error {
  public readonly field = 'phone_number';

  constructor(message = 'phone_number must be a valid E.164 number') {
    super(message);
    this.name = 'InvalidPhoneNumberError';
  }
}

/**
 * Parses and normalizes a phone number to canonical E.164, so formatting
 * differences (spaces, dashes, parentheses) collapse to a single account key
 * (BR-01 / AC-9). The input must already be in full international form (leading
 * `+`, no default region); numbers without a `+` or of an impossible length are
 * rejected.
 *
 * We gate on `isPossible()` (correct country-code + length) rather than
 * `isValid()` (assignable-range check) so reserved test ranges such as
 * `+15555550123` — used throughout the spec's test cases — normalize instead of
 * being rejected as unassigned.
 *
 * @throws {InvalidPhoneNumberError} If the input is empty, lacks a `+`, or is
 *   not a possible E.164 number.
 */
export function normalizeE164(input: string): string {
  const parsed = parsePhoneNumberFromString(input);
  if (!parsed || !parsed.isPossible()) {
    throw new InvalidPhoneNumberError();
  }
  return parsed.number;
}
