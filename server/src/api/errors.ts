import { z } from 'zod';
import { AppError } from '../errors.js';
import { InvalidPhoneNumberError } from '../util/phone.js';

/** A serialized error reply: `{ error: { code, message } }` plus its status. */
export interface ErrorReply {
  status: number;
  body: { error: { code: string; message: string } };
}

/**
 * Maps any thrown value to a client error reply. Domain `AppError`s carry their
 * own status + code; a malformed phone is a 400 naming `phone_number`; a Zod
 * body-validation failure is a 400; anything else is an opaque 500 (its message
 * is never leaked). Never surfaces OTP codes, keys, or tokens.
 */
export function toErrorReply(error: unknown): ErrorReply {
  if (error instanceof InvalidPhoneNumberError) {
    return reply(400, 'INVALID_PHONE_NUMBER', error.message);
  }
  if (error instanceof AppError) {
    return reply(error.status, error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    return reply(400, 'INVALID_REQUEST', firstZodMessage(error));
  }
  return reply(500, 'INTERNAL_ERROR', 'Internal server error');
}

function firstZodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request body';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

function reply(status: number, code: string, message: string): ErrorReply {
  return { status, body: { error: { code, message } } };
}
