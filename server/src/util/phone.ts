import { parsePhoneNumberWithError } from 'libphonenumber-js';

export class InvalidPhoneError extends Error {
  constructor(public readonly raw: string) {
    super('invalid phone number');
    this.name = 'InvalidPhoneError';
  }
}

// Requires a full E.164 number (leading `+`, no default region). Returns the
// canonical E.164 form so formatting differences collapse to one account.
export function normalizeE164(raw: string): string {
  try {
    const parsed = parsePhoneNumberWithError(raw);
    if (!parsed.isPossible()) throw new InvalidPhoneError(raw);
    return parsed.number;
  } catch {
    throw new InvalidPhoneError(raw);
  }
}
