/**
 * Domain error types thrown by services. Each carries an HTTP `status` and a
 * machine-readable `code`; the API layer (api/errors.ts) maps them to
 * `{ error: { code, message } }` replies. Keeping them framework-free lets
 * services stay unaware of Fastify.
 */

/** Stable machine-readable error codes surfaced to clients. */
export type ErrorCode =
  | 'INVALID_OTP'
  | 'REFRESH_INVALID'
  | 'OTP_REQUEST_FAILED'
  | 'INVALID_PHONE_NUMBER'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND';

/** Base class for all thrown domain errors. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ErrorCode,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** The submitted OTP code was not approved (unapproved / expired). 400. */
export class InvalidOtpError extends AppError {
  constructor(message = 'The verification code is invalid or expired') {
    super(message, 400, 'INVALID_OTP');
  }
}

/** A refresh token was missing, malformed, wrong-type, expired, or stale. 401. */
export class RefreshInvalidError extends AppError {
  constructor(message = 'The refresh token is invalid or expired') {
    super(message, 401, 'REFRESH_INVALID');
  }
}

/** The OTP provider failed to send (upstream/Twilio error). 502. */
export class OtpRequestFailedError extends AppError {
  constructor(message = 'Failed to send the verification code') {
    super(message, 502, 'OTP_REQUEST_FAILED');
  }
}

/** The access token was missing/invalid/expired/wrong-type/stale. 401. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}
