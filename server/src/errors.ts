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

export class CookbookExistsError extends AppError {
  /** 409 COOKBOOK_EXISTS — the caller already owns a cookbook with that name. */
  constructor() {
    super('COOKBOOK_EXISTS', 409, 'you already have a cookbook with that name');
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
