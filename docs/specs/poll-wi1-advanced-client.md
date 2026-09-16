# WI-1: Advanced iMessage client (shared-mode gRPC factory)

## Background

Poll votes are not delivered by our Spectrum webhook; they arrive only on the advanced
kit's `polls.subscribeEvents()` gRPC stream, and polls are created via `polls.create()`
(spike, 2026-09-15 — see `docs/imessage-polls-design.md` Appendix B). Both need a
`@photon-ai/advanced-imessage` gRPC client. On our Free/shared plan the client is built
exactly as `@spectrum-ts/imessage` builds it internally: address
`imessage.spectrum.photon.codes:443`, bearer token minted from `PHOTON_PROJECT_ID/SECRET`
via `POST https://spectrum.photon.codes/projects/{id}/imessage/tokens` (returns
`{type:"shared", token, expiresIn:900}`). WI-2 and WI-3 depend on this.

## Objective

Add a single module that returns a ready `@photon-ai/advanced-imessage` gRPC client for our
shared line, minting and supplying the bearer token. One chokepoint both the send tool and
the vote worker use.

## Acceptance Criteria

1. Given valid `PHOTON_PROJECT_ID/SECRET`, when `createAdvancedClient()` is called, then it
   returns a client whose `polls.create(...)` and `polls.subscribeEvents(...)` succeed against
   the live shared line.
2. Given the token endpoint returns `{type:"shared", token, expiresIn}`, when the client is
   built, then it authenticates with that token and address `imessage.spectrum.photon.codes:443`
   (override via `SPECTRUM_IMESSAGE_ADDRESS`).
3. Given the token TTL (~900s), when the client is used for longer than one call, then the
   token function re-mints on expiry (pass a `token: async () => …` that refreshes when stale).
4. `@photon-ai/advanced-imessage` is a declared dependency in `server/package.json` (not only transitive).
5. Missing/blank creds throw a clear error naming the missing env var — no silent empty client.

## Test Cases

### Test Case 1: Live create against shared line
**Preconditions:** `.env` has `PHOTON_PROJECT_ID/SECRET`.
**Steps:** call `createAdvancedClient()`, then `client.polls.create('any;-;+15128267702','WI-1 check',['A','B'])`.
**Expected Outcomes:** resolves with `pollMessageGuid` + `options[].optionIdentifier`; no throw. (Mirrors `scripts/spike-poll-raw.ts`.)

### Test Case 2: Token minting unit
**Preconditions:** mock `fetch` for the tokens endpoint returning `{succeed:true,data:{type:"shared",token:"T",expiresIn:900}}`.
**Steps:** call the token-mint helper.
**Expected Outcomes:** returns `"T"`; sends `Authorization: Basic base64(id:secret)`.

### Test Case 3: Missing creds
**Preconditions:** unset `PHOTON_PROJECT_SECRET`.
**Steps:** call `createAdvancedClient()`.
**Expected Outcomes:** throws an error naming `PHOTON_PROJECT_SECRET`.

## Test Run
_To be determined._

## Deployment Strategy

Library-only; no runtime path changes until WI-2/WI-3 use it. Direct deploy. Adds one
dependency — verify the deployed bundle includes `@photon-ai/advanced-imessage`.

## Production Verification

### Production Verification 1: Client builds in prod
**Preconditions:** deployed with prod `PHOTON_PROJECT_ID/SECRET`.
**Steps:** invoke a temporary/route or WI-3 worker that calls `createAdvancedClient()` and logs `polls.get` on a known guid (or a no-op connect).
**Expected Outcomes:** client connects; logs show a minted `type=shared` token, no auth error.

## Production Verification Run
_To be determined._
