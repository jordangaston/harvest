import { ZodError } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvalidPhoneError } from '../util/phone.js';

export class AppError extends Error {
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
  constructor() {
    super('INVALID_OTP', 400, 'the code is incorrect or expired');
  }
}

export class RefreshInvalidError extends AppError {
  constructor() {
    super('REFRESH_INVALID', 401, 'the refresh token is invalid');
  }
}

export class OtpRequestFailedError extends AppError {
  constructor() {
    super('OTP_REQUEST_FAILED', 502, 'could not send the verification code');
  }
}

export class UnsupportedSourceError extends AppError {
  constructor() {
    super('UNSUPPORTED', 422, 'this source cannot be imported');
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super('NOT_FOUND', 404, 'not found');
  }
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof InvalidPhoneError) return new AppError('INVALID_PHONE', 400, 'phone_number is invalid');
  if (error instanceof ZodError) return new AppError('INVALID_REQUEST', 400, error.issues[0]?.message ?? 'invalid request');
  return new AppError('INTERNAL', 500, 'internal error');
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);
    reply.code(appError.status).send({ error: { code: appError.code, message: appError.message } });
  });
}
