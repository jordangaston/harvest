# S5 — Returning-user sign-in

**Story.** As a returning user (new device or after logout), I tap "Log in" on Welcome, verify my
phone by code, and land on my existing account.

## Files
- `app/(onboarding)/welcome.tsx` — "Log in" routes to `/(onboarding)/phone?mode=signin` instead of
  jumping straight into the app.
- `app/(onboarding)/phone.tsx` — reads `mode` param; in `signin` mode the CTA still sends the OTP but
  pushes `verify-code?mode=signin` (no name step).
- `app/(onboarding)/verify-code.tsx` — reads `mode`; in `signin` mode calls `signIn(phone, code)`
  (→ `POST /v1/users/sign_in`) instead of `createUser`, and routes to `/(app)/recipes` on success.
- `lib/api/auth.ts` — `signIn(phone, code)` → `POST /v1/users/sign_in` with
  `{ auth: { otp: { phone_number, code } } }`; on success `setSession` + `queryClient.clear()`.

## Behavior
- One set of phone/code components, two entry points (signup vs `mode=signin`), branched by the param.
- Sign-in has no name step and does not touch the onboarding accumulator.

## Acceptance criteria → tests
- AC1: from Welcome → Log in → phone + `123456` for an existing phone → lands on recipes on the same
  account (same user id). (demo, against a user created earlier in the same session)
- AC2: sign-in for a wrong code shows an inline error. (demo)
- AC3: server sign-in-by-OTP + refresh tests remain green (S2 suite). (test)

## Notes
Server behavior is unchanged for sign-in — the OTP path already verifies + resolves. Q-02
(sign-in for a never-registered number provisions a nameless user) is accepted as-is for v1.
