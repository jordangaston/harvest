# Phone Auth — POSTMORTEM (kept open during the sprint)

Running log of decisions-under-uncertainty, deviations, and gotchas. Founder-level blockers escalate;
everything else is decide-and-log here.

## Parallelism workarounds (required by the brief, reverted before commit)

- **Test DB isolation.** Six worktrees share one local Postgres and `global-setup` resets the schema.
  Before running tests I point the suite at worktree-unique DBs `harvest_test_phoneauth` /
  `harvest_dbos_phoneauth` (edit `server/vitest.config.ts` `test.env`), verify green in isolation,
  then **revert the edit before committing** so the PR diff keeps the default `harvest`.
- **Simulator isolation.** The iOS sim is shared. Phase-7 demos run on a dedicated device
  (`Harvest-phoneauth`) via `xcrun simctl`, targeted with `IDB_UDID`, Metro on a unique port. Not a
  product change; nothing to revert.

## Pre-mortem (Phase 5) findings folded into the build

- **Build-breaking trio in one commit.** `client.ts` (imports `ensureSession`/`provisionUser`),
  `setting-up.tsx` (imports `ensureSession`), and the `auth.ts` rewrite must land together or TS
  fails to compile. Done together.
- **`verifyOtp` is the literal first line of `createUser`,** before any `findByPhone`/insert — a bad
  code never touches the DB, and an existing phone can't skip verification.
- **Never wire `/v1/otps/verify` into mobile.** Twilio Verify consumes the code on first approved
  check; the client verifies exactly once, at `createUser`/`signIn`. The stub wouldn't catch a
  double-verify (stateless), so this is a live-only hazard — avoided by construction.
- **`setSession()` (+ `queryClient.clear()`) awaited before navigation,** so the first protected
  `apiFetch` after landing has a session (client.ts now throws `NO_SESSION` when absent).
- **Existing tests updated, not just extended:** `createAccount()` now sends `code` + `name`; the
  session-user and `/me` `toEqual` assertions include `name` (exact match); added the bad-code test.
- **`setting-up` progress** bumped to 1.0 (was 0.88, which collided with the new phone step).
- **Keyboard reachability:** the shared `OnboardingScreen` pins its CTA (no KeyboardAvoidingView), so
  the input screens also submit via the keyboard return key (`onSubmitEditing`) — CTA works once the
  keyboard dismisses. Chose not to modify the shared component for all screens (ponytail).
- **`.env` key mismatch (live-only):** local `server/.env` uses `TWILIO_VERIFY_SERVICE`, but the code
  reads `TWILIO_VERIFY_SERVICE_SID`. Surfaced in FOUNDER-ACTION; irrelevant offline (`.env` is skipped
  under `NODE_ENV=test`).

## Decisions & deviations

- **`queryClient.clear()` on every new session** (signup + sign-in) to drop a prior account's
  persisted cache on a shared device. Ceiling: the AsyncStorage persister writes async, so a very fast
  relaunch could rehydrate stale cache — out of scope for v1.
- **`client.ts` refresh-failure** no longer re-provisions (impossible without a verified phone): it
  clears the session and throws `REAUTH_REQUIRED`. No global 401→Welcome interceptor this wave (rare
  path, 30-day refresh); logged as a known ceiling.

## Gotchas hit

- **Disk hit 100% → shared Postgres (5432) crashed.** Six worktrees' `node_modules` + Xcode/sim/npx
  caches filled the Data volume; `npm install` failed ENOSPC and the shared **EnterpriseDB PostgreSQL
  17** cluster on 5432 (the harvest DB) crashed. Reclaimed ~3.2G via `rm -rf ~/.npm/_npx`. The EDB
  cluster needs **root** to restart (`/Library/LaunchDaemons/postgresql-17.plist`) — escalated to the
  coordinator (machine-wide, affects all sprints). Did **not** wait: pointed my test+dev DB at the brew
  `postgresql@14` on **5433** (a `postgres` superuser role already existed there — another sprint hit
  the same wall). Deviation is local-only and reverted before commit.
- **Test-DB isolation needed THREE edits, not one.** Beyond `vitest.config.ts` `test.env`,
  `tests/helpers/global-setup.ts` calls `ensureDatabases(LOCAL_ADMIN_URL)` with a **hardcoded 5432
  admin URL**. Added a `process.env.PG_ADMIN_URL ?? LOCAL_ADMIN_URL` override (revert before commit)
  and exported `PG_ADMIN_URL`/`DATABASE_URL`/`DBOS_SYSTEM_DATABASE_URL` at 5433 so global-setup, the
  app pool, and DBOS all agree. Lesson for the next Lead: the admin URL is a third hardcoded 5432 site.
- **More tests broke than just phone-auth.** `createUserSchema` requiring `code`+`name` broke every
  suite that mints a token via `POST /v1/users` (`cookbook`/`recipe`/`import` integration
  `mintBearer`, plus the `user-service` unit test). All use the offline stub, so adding
  `code:'123456'` (+ a name) fixed them. Grep `POST /v1/users` before changing its contract.
- **Port collision on 3000.** Another sprint's dev server holds `:3000` (pointed at the dead 5432, so
  its `/healthz` shows `db:error`). Ran mine on `:3010` (config pointed at it for the sim demo, reverted
  before commit). Mirror the DB/sim isolation for the dev server too.
- **Simulator isolation.** Created + booted a dedicated `Harvest-phoneauth` device via `xcrun simctl`,
  targeted with `IDB_UDID`, Metro on `:8082`. Expo Go (SDK 54) ran the bundle fine.
- **Sim can't type into the `oneTimeCode` field.** The 6-digit verify input uses
  `textContentType="oneTimeCode"` (correct UX — enables OS OTP autofill). The iOS simulator's HID text
  injection (`ui_type`) does not land digits in that autofill field: the field focuses (cursor blinks)
  but keystrokes are dropped, so the final code→recipes hop wasn't captured on the sim. Not an app bug —
  the normal name/phone text inputs typed fine, the backend `sign_in`/`createUser` are curl-proven, and
  `tsc` is clean. Kept the correct `oneTimeCode` attribute rather than degrade real-device UX for the
  test harness.
