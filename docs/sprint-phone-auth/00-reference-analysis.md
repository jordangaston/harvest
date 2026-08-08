# Phone-based Auth — reference analysis (CLARIFY gate)

No reference video for this task. This analysis is against the **live code** (Cleanup, merged to `main`).

## Headline: the server is done; the gap is mobile

Cleanup already shipped the **entire server-side OTP stack**. Twilio Verify is wired, tested, and
falls back to an offline stub. What's missing is the **mobile UI** that collects a real phone, sends
a code, verifies it, and creates the user with that phone instead of a random one.

### Server (built, tested — `server/src/…`)
- `POST /v1/otps` → `OtpService.requestOtp` → provider `send()`. Returns `{ otp: { status: 'pending' } }`.
- `POST /v1/otps/verify` → `OtpService.verifyOtp`. Returns `{ otp: { status: 'approved' } }`, else `400 INVALID_OTP`.
- `POST /v1/users` → `UserService.createUser({ phoneNumber, onboarding })`. Creates or resolves by phone,
  persists onboarding enums + `onboarding_completed_at`, returns a session. **Trusts the phone — does NOT
  require an OTP.** (Comment: "verification happens separately.")
- `POST /v1/users/sign_in` → OTP **or** refresh token → session. The OTP path provisions on first sign-in
  but **carries no onboarding** (`provision(phone)` with no columns).
- Provider (`providers/otp-provider.ts`): `TwilioVerifyOtpProvider` (live) vs `StubOtpProvider`
  (fixed code `123456`, no network). `selectOtpProvider()` picks Twilio only when all three
  `TWILIO_*` env vars are set; otherwise the stub. Env vars are all `.optional()` today.
- Phone normalization (`util/phone.ts`): `normalizeE164` requires a **full E.164 input** (leading `+`,
  no default region) — the mobile UI must supply a country code.
- Tests: `tests/integration/phone-auth.test.ts` exercises the whole flow against `StubOtpProvider`
  (never hits the network, per `server/CLAUDE.md`).

### Mobile (the gap — `lib/api/auth.ts`, `app/(onboarding)/`)
- `lib/api/auth.ts` **never calls the OTP endpoints.** `provisionUser()` calls `generatePhone()`
  (`+1555555xxxx` random) and POSTs `/v1/users`. This is the "random test phone" to replace.
- Onboarding order: `…age.tsx` → `setting-up.tsx`. `age.tsx` is the last *input* screen;
  `setting-up.tsx` is a 2.5s loader whose `useEffect` fires `ensureSession()` (→ `provisionUser`)
  then routes to `/(app)/recipes`.
- `welcome.tsx` has an **"Already have an account?"** affordance that currently just jumps straight to
  `/(app)/recipes` — there is **no real sign-in**.

## Where our design lands (the shape of the change)
1. Add two onboarding screens — **phone entry** and **code entry** — as the last input step
   (between `age` and `setting-up`, or folded into that tail).
2. Send the code via `POST /v1/otps`; verify via `POST /v1/otps/verify`.
3. Replace `generatePhone()`: create the user with the **verified real phone** + collected onboarding
   via the existing `POST /v1/users`.
4. (Fork — see questions) Decide whether the server should *enforce* verification at creation, and
   whether returning-user sign-in (new device / post-logout) is in scope.

## Open decision forks → see `worker_done` body
1. Does phone-auth *own* user creation (server-enforced verification) or stay client-trusted?
2. Provider + a real number the agent can read codes from for live e2e (required).
3. Returning-user sign-in scope (ties into the Profile task's logout).
4. Country-code handling in the phone-entry UI (E.164 is required).
