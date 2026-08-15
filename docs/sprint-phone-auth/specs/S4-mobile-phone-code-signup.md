# S4 — Mobile phone-entry + code-entry screens (signup) + auth rewrite

**Story.** As a new user, I enter my phone, receive an SMS code, enter it, and land in the app with a
real account carrying my name + onboarding — replacing the random test phone.

## Files
- `lib/api/auth.ts` — rewrite: remove `generatePhone()`, `provisionUser()`, `ensureSession()`. Add:
  - `sendOtp(phone: string): Promise<void>` → `POST /v1/otps`.
  - `createUser(phone, name, code): Promise<Session>` → `POST /v1/users` with
    `{ user: { phone_number, name, code, onboarding } }`; on success `setSession` + `resetOnboarding` +
    `queryClient.clear()` (drop any prior account's persisted cache); return session.
  - `signIn(phone, code): Promise<Session>` (S5) and keep `refreshSession`.
- `app/(onboarding)/phone.tsx` — new. `+1`-prefixed phone input (US default); country handling per
  Q-01 (US default, simple). CTA "Send code" → `sendOtp(e164)` → push `verify-code`.
- `app/(onboarding)/verify-code.tsx` — new. 6-digit code input; auto-submit on the 6th digit; resend
  control with a ~30s cooldown. On submit: `createUser(phone, name, code)` → push `setting-up`.
  `INVALID_OTP` → inline error, clear field, allow retry. `OTP_REQUEST_FAILED` on resend → inline error.
- `app/(onboarding)/setting-up.tsx` — remove `ensureSession()`; the account already exists. Pure
  loader → `/(app)/recipes`.
- `lib/api/client.ts` — `apiFetch` reads `getSession()`; if none, throw `ApiError(401, "NO_SESSION")`;
  on a 401 refresh **failure**, `clearSession()` and rethrow (no re-provision).

## Behavior / design system
- Both screens use `OnboardingScreen` chrome; inputs `bg-card`, never `bg-white`; the stack's
  `slide_from_right` supplies motion; honor Reduce Motion (no custom animation added, so the native
  slide already respects it — any added animation must gate on `AccessibilityInfo`).
- Phone → E.164 before send (client builds `+1` + digits; server re-normalizes and is the authority).
- Progress ~0.88 (phone), ~0.94 (code).

## Acceptance criteria → tests
- AC1: entering phone + `123456` (stub) creates the user and lands on recipes with a persisted session. (demo)
- AC2: a wrong code shows an inline error and does not advance. (demo)
- AC3: `setting-up` no longer provisions; no random phone anywhere in `lib/`. (grep + typecheck)
- AC4: `queryClient.clear()` runs on new-session establishment. (code review + typecheck)

## Notes
Verify happens once, at `createUser` (server-side) — the client does **not** call `/v1/otps/verify`.
