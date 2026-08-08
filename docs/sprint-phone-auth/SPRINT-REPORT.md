# Phone Auth — SPRINT REPORT

Real phone-based auth, gathered as the last step of onboarding and used to create the user, plus
returning-user sign-in. Replaces the random `+1555555xxxx` test phone. Built to `DESIGN.md` +
`WAVE2-DECISIONS.md`.

## What shipped

### Server (Fastify + Drizzle)
- **`users.name`** — nullable `text` column. Migration **`0009_flashy_living_tribunal.sql`**
  (`ALTER TABLE "users" ADD COLUMN "name" text`). Backwards-compatible; commits its `meta/` snapshot.
- **Server-enforced verification (Phone Auth owns creation).** `POST /v1/users` now requires `code` +
  `name`; `UserService.createUser` **verifies the OTP first (before any DB access)** and throws
  `INVALID_OTP` on a bad code, so an unverified phone can never provision. On success it provisions with
  the name + onboarding.
- **`name` surfaced** in `UserSchema` and `toPublicUser` → `GET /v1/users/me` and every session
  response now return `{ id, phone, name }` (Architect must-fix; Profile + Instrumentation consume).
- Sign-in (`POST /v1/users/sign_in`) unchanged — the OTP path already verifies; the refresh path is
  untouched.

### Mobile (Expo Router + NativeWind)
- **Three new onboarding screens**, design-system compliant (cream canvas, `bg-card` inputs — no
  `bg-white`, Lora/Karla, native stack slide motion, Reduce-Motion-safe): `name.tsx`, `phone.tsx`,
  `verify-code.tsx`. Flow: `age → name → phone → verify-code → setting-up → recipes`.
- **`lib/api/auth.ts` rewritten** — removed `generatePhone`/`provisionUser`/`ensureSession`; added
  `sendOtp`, `createUser(phone, code)` (drains name + onboarding from the accumulator, sends them with
  the code), `signIn(phone, code)`, and `queryClient.clear()` on every new session (drops a prior
  account's persisted cache on a shared device).
- **Returning-user sign-in** — Welcome's "Log in" now routes to `phone?mode=signin`; the same
  phone/code screens branch on `mode` (sign-in skips the name step and calls `/v1/users/sign_in`).
- **`setting-up.tsx`** demoted to a pure loader (account already created at the code step).
- **`client.ts`** no longer re-provisions on refresh failure (impossible without a verified phone): it
  clears the session and throws `REAUTH_REQUIRED`; a missing session throws `NO_SESSION`.
- **`lib/onboarding.ts`** — `setName` + `name` on the accumulator (mapped to `users.name`, not an enum).

## Sub-stories & demos
| ID | Story | Status | Evidence |
|---|---|---|---|
| S1 | `users.name` in model + `/me` | ✅ | backend curl (`demos/S1-S2-S5-backend-demo.md`) |
| S2 | server verifies + creates | ✅ | backend curl (bad code→400 no user; good→session+name) |
| S3 | name-entry screen | ✅ | `demos/S3-name-screen.png`, `S3-name-typed.png` |
| S4 | phone + code signup | ✅* | phone screen + real OTP send + verify screen (`demos/S5-0*.png`); create hop curl-proven |
| S5 | returning-user sign-in | ✅* | Welcome→phone(signin)→send→verify screens; `sign_in` curl-proven (same user id) |

\* The final code-entry→recipes **UI** hop wasn't captured on the simulator — the `oneTimeCode` OTP
field rejects the sim's HID text injection (harness quirk, not an app defect; see `demos/README.md` +
`POSTMORTEM.md`). The logic is proven by the live backend demo and a clean typecheck.

## Tests
- **Server suite: 87/87 green, 23 files** (offline, `StubOtpProvider`). Extended
  `phone-auth.test.ts` (name persisted + surfaced in `/me`; bad-code→400 creates no user); updated the
  `cookbook`/`recipe`/`import` integration `mintBearer` helpers and the `user-service` unit test to send
  `code` + `name`.
- **Mobile `tsc --noEmit`: clean.**
- Ran against a worktree-isolated DB; **config reverted to the default `harvest` before commit** (see
  POSTMORTEM for the three isolation edits and why a second Postgres on 5433 was used).

## Cross-task interfaces
- **Own → consumed:** `users.name` (Profile display + Instrumentation people-property, null-tolerant
  until this merges); `/v1/users/me` now returns `name`; the sign-in entry point (Profile's logout →
  Welcome → "Log in"); the signup session moment (Instrumentation `identify()`).
- **Contract change to flag:** `restoreSession()`/`client.ts` no longer auto-provision — callers must
  route to Welcome on `NO_SESSION`/`REAUTH_REQUIRED`.

## Migration note (for integration)
Adds **one** nullable column to `users` via `0009`. Self-contained and trivially re-orderable; the
coordinator reconciles the `0009` number across parallel branches.

## Founder action
Live SMS needs Twilio — exact console steps + env vars in **`FOUNDER-ACTION.md`** (includes the
`.env` key mismatch `TWILIO_VERIFY_SERVICE` → `TWILIO_VERIFY_SERVICE_SID` to fix before going live).
Nothing is required for the offline suite or the sim.

## Known ceilings
- No global 401→Welcome interceptor this wave (rare path; 30-day refresh) — logged.
- Sign-in for a never-registered number still provisions a nameless user (server behavior unchanged;
  accepted for v1).
- Live Twilio smoke script not wired (offline stub covers all automated testing).
