# S2 — Server enforces verification + persists name at account creation

**Story.** As the system, `POST /v1/users` must verify the OTP code before creating an account and
must persist the user's name, so an unverified phone cannot provision and Phone Auth owns creation.

## Files
- `server/src/api/schemas.ts` — `createUserSchema.user` gains `code: z.string()` (required) and
  `name: z.string().trim().min(1)` (required).
- `server/src/services/user-service.ts` — `CreateUserRequest` gains `code` + `name`; `createUser`
  calls `otpService.verifyOtp(phone, code)` and throws `InvalidOtpError` on false **before** any
  DB read/write; `provision` accepts and inserts `name`.
- `server/src/api/app.ts` — the `/v1/users` handler passes `code` + `name` through.
- `server/tests/integration/phone-auth.test.ts` — update + extend (see ACs).

## Acceptance criteria → tests
- AC1: create with the stub's good code (`123456`) → 200, one user row, `name` + onboarding enums +
  `onboardingCompletedAt` persisted, no secrets in the body.
- AC2: create with a bad code (`000000`) → 400 `INVALID_OTP`, **users table still empty** (verify
  precedes provision).
- AC3: `/me` for the created user returns the persisted `name`.
- AC4: existing sign-in-by-OTP and refresh-token tests still pass (createAccount helper now sends
  `code` + `name`).

## Notes
Verify **exactly once**, here — Twilio Verify consumes the code on the first approved check, so the
mobile client must not also call `/v1/otps/verify`. `/v1/otps/verify` stays for tests but is off the
mobile happy path. Verify before `findByPhone` so a bad code never touches the DB.
