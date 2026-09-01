# WI-WEB-2 — Serve the React SPA shell from Nitro

## Background

Harvest Web (`docs/harvest-web/DESIGN.md`) is a React app the existing Nitro server hosts, that Chef
links to from iMessage. **WI-WEB-1** builds the server auth handoff (the `web_link` sign-in grant).
This work item builds the **client shell that consumes it**: a Vite-built React SPA served under
`/app/*`, which on load exchanges the link token for a session and renders a signed-in shell. No
feature page yet — the first interactive flow is deferred (design Q-01). This ships the platform those
flows plug into.

System context:
- Nitro serves `server/public/` at the web root by convention (`nitro.config.ts`, no custom static
  config today). The recipe page (`server/src/recipe-page.tsx`) proves React SSR already builds under
  Nitro/rolldown; this WI adds a **client** bundle.
- The API is `/v1/*` (`server/src/index.ts`); `POST /v1/users/sign_in` gains the `web_link` grant in
  WI-WEB-1, and `GET /v1/users/me` returns the authed user.
- Design tokens live in `tailwind.config.js` (root); wordmark Lora, body Karla; canvas `cream`, surface
  `card`, primary `brand`.

**Depends on WI-WEB-1** (the `web_link` grant must exist to exchange).

`[ASSUMPTION Q-04: the web app lives in an in-repo `web/` directory whose `vite build` outputs to `server/public/app`; the server build runs it. Alternative (sibling package) deferred.]`
`[ASSUMPTION Q-02: session stored in localStorage for this shell MVP; httpOnly-cookie hardening (+ CSRF) is a follow-up work item.]`
`[ASSUMPTION Q-05: the golden-hour Tailwind theme is copied into the web app's Tailwind config for now; extracting a shared token package is deferred.]`
`[ASSUMPTION: client routing via a small router (e.g. React Router) with a catch-all so deep links resolve; exact library is implementer's choice.]`

## Objective

Stand up a Vite React SPA served by Nitro at `/app/*` that, on load, reads the `#t=<token>` fragment,
exchanges it via `POST /v1/users/sign_in { auth: { web_link } }`, stores the session, strips the token
from the URL, and renders a golden-hour signed-in shell greeting the user. Deep links and refreshes
resolve to the SPA; an absent/expired token shows a clear non-crash state.

## Acceptance Criteria

- **AC1** — `vite build` produces `server/public/app/index.html` and hashed JS/CSS assets. The server
  build pipeline runs it so the bundle ships in the same Nitro artifact (one deploy).
- **AC2** — `GET /app/` returns the SPA `index.html`; `GET /app/<anything>` (a deep link with no matching
  file) also returns `index.html` (SPA fallback), so client routing resolves on refresh. Hashed assets
  are served with correct content-types.
- **AC3** — Loading `/app/#t=<valid token>` exchanges the token, stores the session, removes `#t` from
  the visible URL, and renders a shell that shows the signed-in user's name/phone (from `GET /v1/users/me`).
- **AC4** — Loading `/app/` with **no** token and **no** stored session renders a clear "open this from
  the link Chef sent you" state — not a blank page or a crash.
- **AC5** — Loading `/app/#t=<expired or invalid token>` (server returns `401 EXPIRED_LINK`) renders a
  "this link expired — ask Chef for a new one" state.
- **AC6** — When a stored access token is rejected mid-session (`401`), the client silently refreshes via
  the stored refresh token and retries the request once; a failed refresh drops to the AC4 state.
- **AC7** — The shell uses the Harvest tokens: `cream` canvas, `card` surfaces, `brand` accents, Lora
  wordmark, Karla body — visibly on-brand, matching the recipe page.

## Test Cases

### Test Case 1: Build output lands where Nitro serves it (AC1)
**Preconditions:** Clean checkout.
**Steps:** Run the web build; list `server/public/app`.
**Expected Outcomes:** `index.html` + a hashed `assets/` bundle exist under `server/public/app`.

### Test Case 2: SPA served + deep-link fallback (AC2)
**Preconditions:** `nitro dev` (or a preview build) running; bundle present.
**Steps:** `curl -i http://localhost:3000/app/`; `curl -i http://localhost:3000/app/some/deep/route`.
**Expected Outcomes:** Both return `200 text/html` containing the SPA root element; the JS asset URL
referenced by `index.html` returns `200` with `content-type: text/javascript`.

### Test Case 3: Token exchange signs the user in (AC3) — E2E
**Preconditions:** `nitro dev`; a `web_link` token minted by a test helper (from WI-WEB-1) for a seeded user.
**Steps:** Playwright: navigate to `/app/#t=<token>`; wait for the shell.
**Expected Outcomes:** The shell shows the seeded user's name; the URL no longer contains `#t=`;
`localStorage` holds a session; a follow-up `GET /v1/users/me` (observed via network) returned `200`.

### Test Case 4: No token → guidance state (AC4)
**Steps:** Playwright: navigate to `/app/` with empty storage.
**Expected Outcomes:** The "open this from your Chef link" copy renders; no uncaught error in the console.

### Test Case 5: Expired token → expired state (AC5)
**Preconditions:** A token minted with a past expiry.
**Steps:** Navigate to `/app/#t=<expired>`.
**Expected Outcomes:** The "link expired" copy renders; no session stored.

### Test Case 6: Silent refresh (AC6)
**Preconditions:** A stored session whose access token is expired but refresh token valid.
**Steps:** Load the shell; observe network.
**Expected Outcomes:** A `401` on the first `/v1` call is followed by a `sign_in` refresh and a retried
call that succeeds; the shell renders signed-in.

## Test Run

_To be filled in during execution._

## Deployment Strategy

Direct deploy, low risk — additive. The SPA bundle ships inside the existing Nitro artifact under
`public/app`; no new service. `PUBLIC_APP_URL` (already used by the recipe card) must point at the
deployed origin so minted links resolve. Nothing else consumes `/app/*` yet, so shipping ahead of the
first feature flow is safe. Rollback: revert the code; the static bundle disappears with it.

## Production Verification

### Production Verification 1: Real link opens the shell
**Preconditions:** Deployed server; a real user; a link minted via WI-WEB-1.
**Steps:** Open the link on a device (or Chef sends it); observe.
**Expected Outcomes:** The signed-in shell renders with the user's name; the URL has no `#t=`.

### Production Verification 2: Deep link on refresh
**Steps:** After signing in, hard-refresh a deep `/app/...` route.
**Expected Outcomes:** The SPA reloads and stays signed in (stored session), no `404`.

## Production Verification Run

_To be filled in after deploy._
