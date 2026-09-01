# WI-WEB-1 — Web-link auth grant (backend)

## Background

Harvest Web (`docs/harvest-web/DESIGN.md`) lets Chef link a user from iMessage into a signed-in web
app. Chef already knows who the user is (a thread maps to a user), so the user must not re-authenticate
on the web. This work item builds the **server half** of that handoff: mint a long-lived credential for
a known user, and accept it as a new sign-in grant that exchanges for the normal session.

System context (all in `server/`):
- `AuthService` (`src/services/auth-service.ts`) owns sessions. Each user has a per-user ES256 keypair
  (`users.jwt_private_key` / `jwt_public_key`). Tokens carry `{ sub, type, nonce }`; a `nonce` checked
  against the user row enables revocation. `TokenType` is currently `"access" | "refresh"`.
- `POST /v1/users/sign_in` (`src/index.ts`) accepts `auth.otp` or `auth.refresh_token` (exactly one,
  per `signInSchema` in `src/schemas.ts`) and returns `{ user, auth: { access_token, refresh_token } }`.
- `UserService.userForToken(token, type)` (`src/services/user-service.ts`) is the single place a token
  resolves to its owner: decode `sub` → load user → `AuthService.verify` → compare the per-type nonce.
- `users` (`src/schema.ts`) has `access_token_nonce` and `refresh_token_nonce` (`int not null default 0`).
- Errors subclass `AppError` (`src/errors.ts`) with a status; `toAppError` in `src/index.ts` maps them.

Design decision D2 sets the credential lifetime: the web-link token is **long-lived (≥30 days) and
reusable** — tapping the same iMessage message must keep working — with a per-user nonce as the
revocation lever. Open question Q-03 is resolved to reusable-until-expiry.

## Objective

Add a third sign-in grant, `web_link`, and a `WebLinkTokenService` that mints the link for a known
user, backed by an additive `users.web_link_nonce` column. A valid web-link token exchanges at
`POST /v1/users/sign_in` for a normal access/refresh session; an expired or revoked token returns
`401 EXPIRED_LINK`. No existing grant or endpoint changes behavior.

`[ASSUMPTION: default web-link TTL = 30 days, as a named constant WEBLINK_TTL = "30d". The design says "≥30d"; 30d is the floor.]`
`[ASSUMPTION: WebLinkTokenService.linkFor reads PUBLIC_APP_URL from env and throws if unset — a link with no origin is unusable. The token itself is minted regardless.]`
`[ASSUMPTION: new AppError subclass WebLinkInvalidError → HTTP 401, code "EXPIRED_LINK" (mirrors InvalidOtpError/RefreshInvalidError).]`

## Acceptance Criteria

- **AC1** — `AuthService` supports a `"weblink"` token type: `mintWebLink(user)` returns an ES256 JWT
  signed with the user's private key, claims `{ sub: user.id, type: "weblink", nonce: user.webLinkNonce }`,
  `exp ≥ now + 30 days`.
- **AC2** — `WebLinkTokenService.linkFor(userId, path)` returns `${PUBLIC_APP_URL}/app${path}#t=<jwt>`,
  where `<jwt>` is the AC1 token for that user. Throws if the user is unknown or `PUBLIC_APP_URL` is unset.
- **AC3** — Given a user and a valid web-link token for them, when `POST /v1/users/sign_in` is called
  with `{ auth: { web_link: <token> } }`, then it returns `200` with `{ user, auth: { access_token,
  refresh_token } }` — the same shape the OTP and refresh grants return.
- **AC4** — Given an **expired** web-link token, when it is exchanged, then the response is `401` with
  body `{ error: { code: "EXPIRED_LINK", ... } }` and no session is issued.
- **AC5** — Given a web-link token whose `nonce` no longer matches the user's `web_link_nonce` (the
  nonce was bumped = revoked), when it is exchanged, then the response is `401 EXPIRED_LINK`.
- **AC6** — Given a token that is not a web-link token (an access token, or one signed by a different
  key), when it is exchanged as `web_link`, then the response is `401 EXPIRED_LINK` (never `500`, no session).
- **AC7** — `signInSchema` accepts exactly one of `otp`, `refresh_token`, `web_link`; providing two, or
  none, returns `400 INVALID_REQUEST`. The existing OTP and refresh grants are unchanged.
- **AC8** — A Drizzle migration adds `users.web_link_nonce int not null default 0`; existing rows read
  as `0`; `UserSchema` gains `webLinkNonce`. Access/refresh sign-in continue to pass unchanged.

## Test Cases

### Test Case 1: Mint a web-link token and URL (AC1, AC2)
**Preconditions:** A seeded user with a generated keypair (reuse `AuthService.generateKeyPair` +
`UserRepository.insert`, as in `test/import-notify.test.ts`). `process.env.PUBLIC_APP_URL = "https://h.example"`.
**Steps:**
1. Call `WebLinkTokenService.linkFor(user.id, "/")`.
2. Parse the URL; extract the `t` fragment; `jwt.verify` it with the user's public key.
**Expected Outcomes:** URL is `https://h.example/app/#t=<jwt>`. Decoded claims: `sub === user.id`,
`type === "weblink"`, `nonce === 0`, `exp - iat >= 30*24*3600`.

### Test Case 2: Exchange a valid token for a session (AC3)
**Preconditions:** Seeded user; a valid web-link token minted for them. App built via `buildApp(db)`.
**Steps:** `POST /v1/users/sign_in` with `{ auth: { web_link: <token> } }`.
**Expected Outcomes:** `200`; body has `user.id === user.id` and non-empty `auth.access_token` and
`auth.refresh_token`. The returned access token authenticates `GET /v1/users/me` as that user.

### Test Case 3: Expired token rejected (AC4)
**Preconditions:** A web-link token minted with `expiresIn: "-1s"` (helper override) for a seeded user.
**Steps:** `POST /v1/users/sign_in` with that token.
**Expected Outcomes:** `401`; body `error.code === "EXPIRED_LINK"`; no tokens in the response.

### Test Case 4: Revoked token rejected (AC5)
**Preconditions:** Valid token minted at `web_link_nonce = 0`; then update the user row to
`web_link_nonce = 1`.
**Steps:** Exchange the token.
**Expected Outcomes:** `401 EXPIRED_LINK`.

### Test Case 5: Wrong token type / foreign key rejected (AC6)
**Preconditions:** (a) A valid **access** token for the user; (b) a web-link-shaped token signed with a
different user's private key.
**Steps:** Exchange each as `{ auth: { web_link } }`.
**Expected Outcomes:** Both return `401 EXPIRED_LINK`; neither returns `500`.

### Test Case 6: Grant exclusivity (AC7)
**Preconditions:** App built.
**Steps:** `POST /v1/users/sign_in` with (a) `{ auth: {} }`; (b) `{ auth: { web_link: "x", refresh_token: "y" } }`.
**Expected Outcomes:** Both return `400` with `error.code === "INVALID_REQUEST"`.

### Test Case 7: Migration is additive (AC8)
**Preconditions:** Fresh migrated file DB (`tests/helpers` harness).
**Steps:** Run the existing `import-notify` and any auth/sign-in tests unchanged; inspect the `users`
table schema.
**Expected Outcomes:** `web_link_nonce` column present, default `0`; all pre-existing tests pass.

## Test Run

_To be filled in during execution — commands, output, pass/fail per test case._

## Deployment Strategy

Direct deploy, low risk. One additive, backwards-compatible migration
(`users.web_link_nonce int not null default 0`) that old code ignores; run it before or with the
deploy. The new grant is inert until Chef mints links (WI-WEB-2 / a later flow), so shipping the
server ahead of any caller is safe. No feature flag needed. Rollback: revert the code; the column is
harmless if left in place.

## Production Verification

### Production Verification 1: Round-trip a real link
**Preconditions:** Deployed server with `PUBLIC_APP_URL` set; a real user id.
**Steps:** Mint a link via `WebLinkTokenService.linkFor(userId, "/")` (a one-off script, mirroring the
existing `server/scripts` probes); `curl -X POST $PUBLIC_APP_URL/v1/users/sign_in` with the token from
the fragment.
**Expected Outcomes:** `200` with a session; the access token authenticates `GET /v1/users/me` as that user.

### Production Verification 2: Expired/garbage token fails closed
**Preconditions:** Deployed server.
**Steps:** POST `sign_in` with `{ auth: { web_link: "not-a-jwt" } }`.
**Expected Outcomes:** `401 EXPIRED_LINK`; no `500` in logs.

## Production Verification Run

_To be filled in after deploy._
