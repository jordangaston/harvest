import { ZodError } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvalidPhoneError } from '../util/phone.js';

export class AppError extends Error {
  /**
   * @param code - stable machine-readable error code (also the error `name`).
   * @param status - HTTP status the error handler will send.
   * @param message - human-readable detail returned to the client.
   */
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

export class InvalidOtpError extends AppError {
  /** 400 INVALID_OTP — the submitted code is wrong or expired. */
  constructor() {
    super('INVALID_OTP', 400, 'the code is incorrect or expired');
  }
}

export class RefreshInvalidError extends AppError {
  /** 401 REFRESH_INVALID — the refresh token is unknown, revoked, or expired. */
  constructor() {
    super('REFRESH_INVALID', 401, 'the refresh token is invalid');
  }
}

export class OtpRequestFailedError extends AppError {
  /** 502 OTP_REQUEST_FAILED — the upstream OTP provider could not send the code. */
  constructor() {
    super('OTP_REQUEST_FAILED', 502, 'could not send the verification code');
  }
}

export class UnsupportedSourceError extends AppError {
  /** 422 UNSUPPORTED — the requested import source cannot be handled. */
  constructor() {
    super('UNSUPPORTED', 422, 'this source cannot be imported');
  }
}

export class NotFoundError extends AppError {
  /** 404 NOT_FOUND — the requested resource does not exist (or isn't visible to the caller). */
  constructor() {
    super('NOT_FOUND', 404, 'not found');
  }
}

export class CookbookExistsError extends AppError {
  /** 409 COOKBOOK_EXISTS — the caller already owns a cookbook with that name. */
  constructor() {
    super('COOKBOOK_EXISTS', 409, 'you already have a cookbook with that name');
  }
}

export class InvalidRangeError extends AppError {
  /** 400 INVALID_RANGE — the meal-plan start/end range is missing, malformed, or too wide. */
  constructor(message = 'start and end must be valid dates no more than 31 days apart') {
    super('INVALID_RANGE', 400, message);
  }
}

/**
 * Maps any thrown value to an AppError. InvalidPhoneError and ZodError become 400s;
 * anything unrecognized collapses to a 500 INTERNAL (details not leaked to the client).
 * @param error - the caught value, of unknown type.
 */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof InvalidPhoneError) return new AppError('INVALID_PHONE', 400, 'phone_number is invalid');
  if (error instanceof ZodError) return new AppError('INVALID_REQUEST', 400, error.issues[0]?.message ?? 'invalid request');
  return new AppError('INTERNAL', 500, 'internal error');
}

/**
 * Installs the single Fastify error handler that normalizes every thrown error via
 * {@link toAppError} into a `{ error: { code, message } }` body at its mapped status.
 * @param app - the Fastify instance to attach the handler to.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);
    reply.code(appError.status).send({ error: { code: appError.code, message: appError.message } });
  });
}
