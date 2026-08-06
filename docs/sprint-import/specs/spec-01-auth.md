# Spec 01 — User creation & silent auth/refresh

## Background
Most backend endpoints are JWT-protected (`preHandler: authGuard`, `Authorization: Bearer`). The
app today has no API client, no session, no token storage. `POST /v1/users` returns
`{ user, auth:{access_token, refresh_token}, isNew }` from just a `phone_number` — no OTP needed.
`POST /v1/users/sign_in` with `{ auth:{ refresh_token } }` mints a fresh pair. Jordan chose **silent
auto-provision** (no login UI) and **persist tokens across restarts** (`expo-secure-store`).

## Objective
Give the app a session automatically: on first launch create a user, store the token pair securely,
attach the access token to every API call, and transparently refresh on a 401 — with no user-facing
auth screen.

## Acceptance Criteria
- AC1: Given a fresh install, when the app boots, then it calls `POST /v1/users` once with a
  generated **`isPossible()` E.164** phone (`+1555555` + 4 random digits — verified `+15555550123`
  creates a user), stores the token pair in secure storage, and keeps the same user id on subsequent
  launches (no duplicate user each boot).
- AC2: Given a stored session, when any protected request runs, then it sends
  `Authorization: Bearer <access_token.jwt>`. **Token shape is nested** (verified live):
  `auth.access_token = { jwt, expires_at }`, same for `refresh_token` — persist and send the `.jwt`
  strings, not the objects. Refresh POSTs `{ auth:{ refresh_token: <refreshJwt> } }`.
- AC3: Given the access token is expired/invalid (401), when a protected request is made, then the
  client calls `sign_in` with the refresh token, stores the new pair, and retries the original
  request once — transparently to the caller.
- AC4: Given refresh also fails (401), when retry is attempted, then the client re-provisions a new
  user (fresh `POST /v1/users`) rather than crashing, and the app remains usable.
- AC5: No login, phone-entry, or OTP screen is shown at any point.

## Touches
- New: `lib/api/client.ts` (fetch wrapper: base URL, bearer, 401→refresh→retry), `lib/api/auth.ts`
  (provision/refresh), `lib/api/session.ts` (secure-store get/set/clear), `lib/api/config.ts`
  (`API_BASE_URL = http://localhost:3000`).
- New dep: `expo-secure-store`.
- Wire boot in `app/_layout.tsx` (ensure session before rendering the app tree).

## Test Cases
### Test Case 1: First-launch provisioning
**Preconditions:** Secure store empty; server up at localhost:3000.
**Steps:** Boot app. Inspect secure store and network log.
**Expected Outcomes:** Exactly one `POST /v1/users`; tokens persisted; `user.id` present.

### Test Case 2: Returning launch reuses session
**Preconditions:** Tokens already stored.
**Steps:** Relaunch app.
**Expected Outcomes:** No new `POST /v1/users`; stored token reused; same user id.

### Test Case 3: Expired access token refreshes and retries
**Preconditions:** Store a valid refresh token but a garbage access token.
**Steps:** Trigger a protected call (e.g. list cookbooks).
**Expected Outcomes:** First call 401 → `sign_in` with refresh → new tokens stored → original call
retried and succeeds. Caller sees only the successful result.

### Test Case 4: Refresh failure re-provisions
**Preconditions:** Both tokens invalid.
**Steps:** Trigger a protected call.
**Expected Outcomes:** Client re-runs `POST /v1/users`, stores new pair, app does not crash.

## Test Run
_To be filled during execution._

## Deployment Strategy
Client-only change; ships with the app bundle. No flag — auth is foundational to every other story.

## Production Verification
### Production Verification 1: Session survives cold start
**Preconditions:** App installed, used once.
**Steps:** Force-quit, relaunch, open a protected screen.
**Expected Outcomes:** Content loads without re-provisioning or errors.

## Production Verification Run
_To be filled during execution._
