import { parsePhoneNumberWithError } from 'libphonenumber-js';

export class InvalidPhoneError extends Error {
  /** @param raw - The unparseable input, kept for the caller/error message. */
  constructor(public readonly raw: string) {
    super('invalid phone number');
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Normalize a phone number to canonical E.164 so formatting differences collapse
 * to one account. Requires a full E.164 input (leading `+`, no default region).
 *
 * @param raw - The phone number, expected in E.164 form
 * @returns The canonical E.164 number.
 * @throws InvalidPhoneError if `raw` is unparseable or not a possible number.
 */
export function normalizeE164(raw: string): string {
  try {
    const parsed = parsePhoneNumberWithError(raw);
    if (!parsed.isPossible()) throw new InvalidPhoneError(raw);
    return parsed.number;
  } catch {
    throw new InvalidPhoneError(raw);
  }
}
