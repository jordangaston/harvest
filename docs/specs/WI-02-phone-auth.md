# WI-02: Phone auth vertical — Twilio Verify OTP + self-owned JWT sessions

## Background

Harvest uses the **phone number as the stable account lookup key** (requirement #3), and the app must own
its users table with a separate surrogate PK (BR-01). WI-01 landed the `server/` scaffold (Fastify + Neon
Postgres via Drizzle + in-process DBOS + composition root, no DI container) and the `users` table already has
the needed columns: `id` (uuid PK), `phone` (unique), `jwt_private_key`, `jwt_public_key`, `access_token_nonce`,
`refresh_token_nonce`, `onboarding` (jsonb), `created_at`.

This ticket implements the phone-auth vertical from the design (F-01 verify during onboarding, F-02 sign-in,
O-07 verify-OTP-and-resolve-user):
- **Twilio Verify** sends/checks the SMS OTP; we never store codes (NFR-05). Twilio is behind an `OtpProvider`
  interface with a `StubOtpProvider` for dev/tests so no SMS is sent and nothing costs money in CI.
- **We own sessions**: per-user ECDSA P-256 keypair stored on the user row; ES256 access (15m) + refresh (30d)
  JWTs carrying a `nonce` for revocation; an `authGuard` verifies the access token on protected routes.
- Endpoints (design "APIs" section): `POST /v1/otps`, `POST /v1/users` (create+verify), `POST /v1/users/sign_in`
  (otp or refresh_token), `GET /v1/users/me`.

Reference implementation (patterns to mirror, **strip tsyringe / decorators**):
`~/workspace/phonetastic/phonetastic-server` — `src/services/otp-provider.ts` (`OtpProvider` + `TwilioVerifyOtpProvider`
+ `StubOtpProvider`), `src/services/otp-service.ts`, `src/services/auth-service.ts` (ECDSA/ES256/nonces),
`src/middleware/auth.ts` (`authGuard`), `src/services/user-service.ts` (`createUser`/`signIn`/`resolveUserByOtp`
/`resolveUserByRefreshToken`/`getMe`), `src/repositories/user-repository.ts`, `src/controllers/{otp,user}-controller.ts`.
Harvest divergences: no DI (wire in `container.ts`), phone lives **directly on `users`** (not a separate
`phone_numbers` table), Fastify v5, and the create/sign-in flows return `isNew` so the client can route a
"logged in but new" user into onboarding (F-02 4a).

Out of scope: the mobile screens (WI-06), the import pipeline, rate-limit tuning beyond what Twilio Verify
provides (BR-06 cooldown/max-attempts is largely delegated to Twilio Verify; document the reliance).

[ASSUMPTION: E.164 validation uses a maintained library such as `libphonenumber-js`; malformed numbers are
rejected before any Twilio call.]

**Read current docs before coding** (memorized APIs are stale): Twilio Verify v2 Node SDK
(`verify.v2.services(sid).verifications.create` / `verificationChecks.create`), `jsonwebtoken` ES256 usage,
Fastify v5 `preHandler`/hooks, `libphonenumber-js`.

## Objective

Deliver server-side phone authentication: a Twilio-Verify-backed OTP flow behind a swappable provider, an
`AuthService` issuing/verifying our own ES256 JWTs, transactional find-or-create of a user keyed by E.164
phone, an `authGuard`, and the four endpoints — all wired through the WI-01 composition root and covered by
Vitest unit + integration tests using the stub provider.

## Acceptance Criteria

1. **OtpProvider abstraction.** Given the composition root, when `NODE_ENV`/config selects it, then production
   uses `TwilioVerifyOtpProvider` (real Twilio Verify) and dev/test uses `StubOtpProvider`; both implement
   `send(e164): Promise<void>` and `check(e164, code): Promise<boolean>`. No Twilio network call occurs in tests.
2. **Send OTP.** Given a valid E.164 number, when `POST /v1/otps {otp:{phone_number}}`, then the provider's
   `send` is invoked and the response is `200 {otp:{status:"pending"}}`. Given a malformed number, then `400`
   naming the field, and `send` is NOT called.
3. **Create account (verify + provision).** Given a phone with an approved OTP and no existing user, when
   `POST /v1/users {user:{phone_number, code, onboarding?}}`, then the OTP is checked via the provider, a
   `users` row is created **in one transaction** (generating the ECDSA keypair + persisting onboarding), and
   the response is `200 {user:{id,phone}, auth:{access_token,refresh_token}, isNew:true}`.
4. **Reject bad OTP.** Given an unapproved/expired code, when creating or signing in, then `400 INVALID_OTP`
   and no user is created / no tokens issued.
5. **Transactional provisioning.** Given a DB failure during provisioning, when `POST /v1/users`, then the
   transaction rolls back (no partial user), and the response is `5xx` — a subsequent retry can still succeed.
6. **Sign in by OTP.** Given an existing user's phone + approved OTP, when `POST /v1/users/sign_in
   {auth:{otp:{phone_number,code}}}`, then it resolves the existing user (no duplicate row) and returns fresh
   tokens with `isNew:false`. Given a verified number with **no** account, then it creates the account and
   returns `isNew:true` (F-02 4a).
7. **Sign in by refresh token.** Given a valid, non-expired refresh token whose nonce matches the user row,
   when `POST /v1/users/sign_in {auth:{refresh_token}}`, then new tokens are returned with **no** OTP/SMS.
   Given a refresh token of the wrong `type`, an expired one, or a stale nonce, then `401`.
8. **authGuard.** Given `GET /v1/users/me` with a valid `Authorization: Bearer <access jwt>`, then `200`
   with the user; given a missing/invalid/expired token, a refresh token used as access, or a stale nonce,
   then `401` and no handler body runs.
9. **Phone is the unique lookup key (BR-01).** Given two verifications of the same E.164 number, then exactly
   one `users` row exists; the surrogate `id` is never used as the external identifier. E.164 is normalized
   (via libphonenumber) before lookup/store so formatting differences collapse to one account.
10. **No secrets leak.** OTP codes are never persisted or logged; private keys and tokens never appear in logs
    or in `GET /v1/users/me` output. Sessions are our ES256 JWTs (NFR-05).

## Test Cases

### Test Case 1: Send OTP happy + malformed (AC-2)
**Preconditions:** App built with `StubOtpProvider`.
**Steps:** `POST /v1/otps` with `+15555550123`; then with `"12"`.
**Expected:** First → `200 {otp:{status:"pending"}}`, stub recorded the send. Second → `400` naming
`phone_number`, stub NOT called.

### Test Case 2: Create new account (AC-3, AC-9, AC-10)
**Preconditions:** Empty `users`; stub approves code `123456` for the number.
**Steps:** `POST /v1/otps`; `POST /v1/users {user:{phone_number:"+15555550123", code:"123456", onboarding:{age:"25-34"}}}`.
**Expected:** `200` with `{user:{id,phone}, auth:{access_token,refresh_token}, isNew:true}`; exactly one
`users` row with a keypair + nonces + onboarding persisted; response contains no private key/code.

### Test Case 3: Reject bad OTP (AC-4)
**Preconditions:** Stub configured so `000000` is not approved.
**Steps:** `POST /v1/users {...code:"000000"}`.
**Expected:** `400 INVALID_OTP`; zero `users` rows.

### Test Case 4: Transactional rollback (AC-5)
**Preconditions:** Force the repo insert to throw (inject a failing repo via container override) after OTP approval.
**Steps:** `POST /v1/users` with an approved code.
**Expected:** `5xx`; zero `users` rows (rollback); a normal retry (without the fault) succeeds and creates one row.

### Test Case 5: Sign-in by OTP — existing and brand-new (AC-6)
**Preconditions:** One existing user for number A; number B has no account; stub approves both codes.
**Steps:** sign_in with A's otp; then sign_in with B's otp.
**Expected:** A → `isNew:false`, same `id` as the existing row, no new row. B → `isNew:true`, one new row.

### Test Case 6: Refresh-token sign-in + revocation (AC-7)
**Preconditions:** A user with known keypair; mint a refresh token.
**Steps:** sign_in with `{refresh_token}` (valid) → expect new tokens, no SMS. Then bump the user's
`refresh_token_nonce` and reuse the old refresh token.
**Expected:** First → `200` fresh tokens, stub `send`/`check` never called. Second (stale nonce) → `401`.

### Test Case 7: authGuard on /v1/users/me (AC-8)
**Preconditions:** A user + a valid access token.
**Steps:** `GET /v1/users/me` with the bearer; then with no header; then with the user's *refresh* token as bearer; then with an expired access token.
**Expected:** `200` user for the valid access token; `401` for the other three; the response body never includes key material.

### Test Case 8: AuthService crypto unit (AC-7, AC-10)
**Preconditions:** None (pure).
**Steps:** Generate a keypair; sign access+refresh with nonces; verify each against the public key; verify an
access token as `type=refresh` fails; tamper a token and verify it fails; check `exp` ≈ 15m / 30d.
**Expected:** Round-trips pass; type/tamper/nonce mismatches throw; expiries correct. Real crypto, no mocks.

## Test Run

_To be determined (filled in during execution)._

## Deployment Strategy

Backend on the existing Railway staging service (stacked on WI-01). Add env: `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, plus a `JWT`/auth secret if any is introduced (per-user keys
are in the DB, so likely none). Staging uses **Twilio Verify test credentials / a magic code** where possible
so QA doesn't spend SMS. No schema migration (WI-01 already created `users`). No feature flag (no user-facing
surface yet; the mobile client arrives in WI-06). Rollback = redeploy the previous image.

## Production Verification

### Production Verification 1: Real OTP round-trip (staging)
**Preconditions:** Deployed with real Twilio Verify (or test creds) + a test phone.
**Steps:** `POST /v1/otps` for the test number; receive the SMS; `POST /v1/users` with the real code.
**Expected:** `200` with tokens + `isNew:true`; a `users` row exists keyed by the E.164 number; no code/key
in logs. `GET /v1/users/me` with the returned access token → `200`.

### Production Verification 2: Idempotent identity + refresh
**Preconditions:** The user from PV-1 exists.
**Steps:** sign_in again by OTP (expect same id, `isNew:false`); then sign_in by the stored refresh token.
**Expected:** No duplicate `users` row; refresh path returns fresh tokens with no SMS sent.

## Production Verification Run

_To be determined (filled in during execution)._
