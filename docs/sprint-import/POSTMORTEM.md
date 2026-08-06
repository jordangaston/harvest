# Sprint Post-Mortem — Recipe Import (live log)

> Kept open the whole sprint. Every decision, skip, quota gap, and blocker lands here as it
> happens. Started 2026-08-05.

## Sprint goal
Wire the import API into the Harvest app and complete the import/cookbook/recipe user stories.
Divergence locked: paste-into-modal-then-auto-import (NOT Recime's in-app browser).

## Jordan's answers to the one clarifying batch (step 2)
1. **Data layer → "Also build the backend."** Add cookbooks CRUD, saved-recipes/library,
   save-to-cookbook, and recipe edit/delete endpoints to the Fastify server (migrations + tests),
   then wire the app. Full-stack sprint.
2. **Import testing → "Keys + server are ready."** Running server at `localhost:3000` with valid
   keys. Attempt real imports against the e2e links first; mock only on failure. (Verified:
   `/healthz` → `{status:ok, db:ok}`.)
3. **Auth → "Silent auto-provision."** First launch creates a user with a generated phone number,
   stores tokens, refreshes transparently on 401. No login/OTP UI.
4. **Persistence → "Persist across restarts."** `expo-secure-store` for tokens, `AsyncStorage`
   for any client cache. (Primary source of truth is now the backend per answer 1.)

## Environment facts (verified)
- Backend live at `http://localhost:3000`, Postgres reachable. iOS simulator reaches host via
  `localhost`.
- `.env` present with `APIFY_TOKEN`, `GROQ_API_KEY`, `TWILIO_*`. `DEEPSEEK_API_KEY`/`LAMATOK_API_KEY`
  not seen in the key list — **will verify at import test time; if extraction fails for a platform,
  log the gap and fall back to a fixture, per the never-fail rule.**
- App: Expo 54 / RN 0.81 / expo-router 6 / NativeWind 4. No API client, no token storage, no
  AsyncStorage/secure-store installed yet. Recipes currently in-memory sample data.

## Existing backend surface (real)
- `POST /v1/users` (create+session), `POST /v1/users/sign_in` (refresh via refresh_token),
  `GET /v1/users/me`, `POST /v1/imports`, `GET /v1/imports/:id`, `GET /v1/recipes/:id`.
- `saved_recipes` join = the user's library (import auto-saves). No named cookbooks yet.

## Design decisions (backend extension)
- **Named cookbooks** = new `cookbooks` table (id, user_id, name, created_at) + unique(user_id, name)
  for collision handling. Membership = new `cookbook_recipes` join (cookbook_id, recipe_id).
  `saved_recipes` stays as the flat library.
- **Save-to-cookbook** = set membership on an already-imported (already-saved) recipe. Import keeps
  auto-saving to the library; the explicit "Save" files it into chosen cookbook(s). Matches Recime.
- **Edit = copy-on-write.** Recipes are shared. On PATCH, if >1 user has the recipe saved, clone it
  (recipe+ingredients+steps) for the caller and repoint their saves/memberships to the clone, then
  edit the clone; if the caller is the sole saver, edit in place. Keeps the canonical model clean.
- **Delete = remove from my library** (delete this user's `saved_recipes` + `cookbook_recipes`
  rows). Canonical recipe row is left for other savers.
- **Widen `PublicRecipe`** ingredients to include `quantity_text`/`amount`/`unit` so the app can
  show the exact amount when an ingredient is tapped inside a step.

## Decisions / skips / blockers log
- 2026-08-05: Vercel/Next/AI-SDK skill auto-injections fired throughout (package.json, api/ paths,
  `localhost:`); all irrelevant (Expo RN app + Fastify server). Ignored, not acted on.
- 2026-08-05: **App `node_modules` was absent** — ran `npm install` (exit 0). Server `node_modules`
  also absent in this worktree; installing.
- 2026-08-05: **Server topology.** The live server on :3000 (pid 64061) runs from the *main* worktree
  `~/workspace/harvest/server`, same base commit (2cfcb68) as this `recipe-import` worktree, sharing
  one Postgres + DBOS system DB. My new backend endpoints live in THIS worktree. **Plan:** apply the
  additive migration to the shared DB, then **replace** the running instance — stop pid 64061 and run
  my worktree's server on :3000 (superset of endpoints, same base). Not a second instance on another
  port, to avoid two processes sharing one DBOS_SYSTEM_DATABASE_URL. App points at `localhost:3000`.
- 2026-08-05: iPhone 16 Pro simulator already booted — will use it for step-6 recordings.

## Pre-mortem findings folded (step 4)
A subagent stress-tested the 8 specs against real code. Key corrections adopted (specs amended):
- **P0-1 token shape is NESTED (verified live).** `auth.access_token = { jwt, expires_at }` (access
  15m, refresh 30d) — the OpenAPI's `access_token: string` is stale. Client stores/sends the `.jwt`
  strings; refresh POSTs `{ auth:{ refresh_token: <refreshJwt> } }`. Spec-01 updated.
- **P0-2 phone must be `isPossible()` E.164.** Verified `+15555550123` creates a user (isNew:true).
  Generator = `+1555555` + 4 random digits. `createUser` resolves existing by phone (unique index),
  so a rare collision just merges to one account — harmless. Persist the generated number.
- **P0-3 widening PublicRecipe breaks `recipe.test.ts` `toEqual`.** Not purely additive for tests —
  will update that expectation in the same commit. `amount` is pg `numeric` → serialized as a
  **string** on the wire (like `confidence`).
- **P0-4 new tables need a generated migration.** Order: schema files → `npm run db:generate` →
  commit SQL → `npm test` (global-setup drops public schema + re-applies `./drizzle/*.sql`).
- **P1-3 icon `default` gap.** `mapIngredientIcon` returns `'default'` for anything outside 22
  keywords → the COMMON case for real recipes. App needs `resolveIcon(key) => ICON[key] ?? null` +
  a token-color placeholder chip (never white/broken). Spec-06 note.
- **P1-2 no Modal primitive.** Use RN built-in `<Modal transparent>` for the paste modal,
  new-cookbook sheet, and ingredient popover — no new dep.
- **P3-1 real import error codes (from `import-pipeline.ts`/`enums.ts`):** job `failed` codes are
  `NO_RECIPE`, `FETCH_FAILED`, `MEDIA_UNAVAILABLE`, `EXTRACTION_FAILED`. `UNSUPPORTED` is the
  POST-time **422**, not a job code. `TIMEOUT` is defined but **never thrown** — no server timeout.
  Mapping: `NO_RECIPE` + POST `422`/`400` → "We don't think this contains a recipe"; everything
  else + client poll-timeout → "Oops let's try that again". Spec-02 updated.
- **P3-2 imports can take minutes** (vision model paces carousels to several min; e2e testTimeout
  600s). Client poll budget = ~120s, keep polling while `queued|running`, drive progress from
  `job.progress`. No server-side TIMEOUT added (YAGNI). Spec-02 updated.
- **P4-1 COW is FK-safe.** Saver count = `count(saved_recipes WHERE recipe_id)`. If >1: clone
  recipe+ingredients+steps, repoint only the caller's `saved_recipes` + `cookbook_recipes` to the
  clone; **leave `import_job_recipes` untouched** (provenance). If ==1: edit in place. One txn.
- **P4-2 delete = library-only.** Delete caller's `saved_recipes` + `cookbook_recipes` rows;
  never touch the `recipes` row. 404 if the caller hadn't saved it.
- **P5 no pagination.** Lists are small/unpaginated by design; no `page_token`. Wire types are
  snake_case throughout. Test teardown must delete `cookbook_recipes` → `cookbooks` before
  `recipes`/`users` (serial vitest, `fileParallelism:false`).
- **P2-1 ATS:** added `NSAllowsLocalNetworking` to `app.json` for dev localhost http. Remote recipe
  `image_url` may be http/hotlink-protected → render a token placeholder on `expo-image` `onError`.
  Full https re-host (BR-07) stays deferred. **Decision:** kept `NSAllowsLocalNetworking` (localhost
  only) rather than `NSAllowsArbitraryLoads`; if a demo image is http and blocked, the placeholder
  covers it and I log the specific URL.
- **.env gap:** `DEEPSEEK_API_KEY`/`LAMATOK_API_KEY` not in the key list. TikTok (LamaTok) may
  `FETCH_FAILED` → app shows friendly "try again". Test website/YouTube/Pinterest first (keyless
  public endpoints); fixture-fallback TikTok if needed, and log the gap.
- **Build order adopted:** auth client → deps/lib scaffolding → cookbooks backend (migration first)
  → recipe projection widening (+update test) → import wiring → list/show screens → recipe detail
  (icon fallback) → edit COW → delete.

## Backend implementation (step 5) — DONE, all 71 tests green
- Added tables `cookbooks` (unique user+name, `user_id` cascade-on-user-delete) + `cookbook_recipes`;
  migrations `0004`+`0005`. Repos `CookbookRepository` + `RecipeRepository` extensions
  (isSavedBy/exists/updateContent COW/removeForUser), `CookbookService`, `RecipeService.update/remove`.
  Routes: POST/GET `/v1/cookbooks`, GET `/v1/cookbooks/:id`, PUT `/v1/recipes/:id/cookbooks`,
  PATCH + DELETE `/v1/recipes/:id`. Widened recipe ingredient projection (quantity_text/amount/unit).
- **Bugs found & fixed during test:**
  1. New `cookbooks` FK broke *other* test files' `delete(users)` teardown → made `cookbooks.user_id`
     `ON DELETE CASCADE` (domain-correct; a user's cookbooks die with them) — no other files touched.
  2. Cookbook-create collision returned 500 not 409 → Drizzle wraps the pg error; `isUniqueViolation`
     now walks the `.cause` chain for SQLSTATE 23505.
  3. DELETE tests 500'd → **test bug**: the `auth()` helper set `content-type: application/json` on a
     bodyless DELETE → Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`, which the error handler collapses to 500.
     Dropped the manual content-type (inject sets it for payloads). NOTE: the app client must never set
     content-type on bodyless requests — the client is written to only set it when there's a body.
  4. Fastify v5 needs `reply.code(204).send()` (returning undefined 500'd).
- **Server topology executed:** stopped the main-worktree server (pid 64061) and started mine
  (`npx tsx src/index.ts`, my worktree, all keys). `/healthz` ok; new endpoints verified over HTTP
  (create 201, list ok, duplicate 409). `npm test` earlier dropped+re-migrated the shared dev DB, so
  it's a clean schema-complete state.
- **OpenAPI (`openapi.json`) not yet regenerated** for the 6 new routes — it's documentation the app
  doesn't consume; deferred to end-of-sprint, logged here so it isn't forgotten.

## Frontend implementation (step 5) — code complete, app typechecks clean
- API client `lib/api/*`: config, secure-store `session`, `auth` (silent provision + refresh),
  `client` (401→refresh→retry→re-provision; only sets JSON content-type when there's a body),
  `types`, and resource modules `imports`/`recipes`/`cookbooks`. Import poll budget 120s; error
  mapping keyed off real codes (NO_RECIPE / 422 → "no recipe"; else → "try again").
- Boot: `_layout.tsx` calls `ensureSession()` behind the existing splash gate (non-blocking on failure).
- Screens: Recipes (real cookbook list + empty state + FAB menu), `import.tsx` (paste modal,
  auto-import on submit — NO browser), `importing.tsx` (real poll + friendly errors), `recipe/[id].tsx`
  (detail/preview/edit + ingredient popover w/ haptics + save-to-cookbook + delete), `cookbook/[id].tsx`.
- Components: `NewCookbookSheet` (empty-name + 409 handling), `CookbookPickerSheet` (multi-select +
  inline new-cookbook without leaving the screen), `RecipeCard`, `StepText` (heuristic ingredient
  linking — known ceiling), `SuccessCelebration`. Icon resolver → token placeholder for the common
  `default`/unknown case.
- **Dependency decisions:**
  - `expo install` wrote `expo-clipboard`/`expo-haptics`/`expo-secure-store`/`async-storage` to
    package.json but never populated node_modules, and a later `npm install` failed ERESOLVE
    (`react-dom@19.2.8` peer vs pinned `react@19.1.0` — a web/devtools transitive, not native).
  - **Dropped `@react-native-async-storage/async-storage` (unused — state is server-backed) and
    `expo-clipboard` (convenience only; the input still accepts native long-press paste).** Kept the
    two essentials `expo-secure-store` + `expo-haptics`; installed with `--legacy-peer-deps` (safe —
    the conflict is web-only react-dom). Removed the clipboard button from the import modal.
  - Fixed the app `tsconfig` to `exclude: [node_modules, server]` — it was wrongly typechecking the
    server (DBOS decorator errors) under the app config. Added an app `typecheck` script.

## Live verification in the iOS simulator (step 6) — ALL 8 STORIES PASS
Ran the app in Expo Go on a booted iPhone 16 Pro against the live server, driving each flow. A
real website import (`thecozycook.com/creamy-garlic-chicken`) exercised the full pipeline.
- **Metro conflict:** port 8081 was held by the main worktree's Metro (pid 64867); stopped it and
  ran mine on 8081. Expo Go first served a **stale cached bundle** (old copy) — fixed by
  terminating Expo Go and reopening `exp://127.0.0.1:8081`; my bundle then built (1865 modules, no
  errors).
- **Temp dev shortcut:** pointed `app/index.tsx` at `/(app)/recipes` to reach the feature screens
  without walking 15 onboarding screens. **Reverted to `/(onboarding)/welcome` after recordings.**
- **Recording tooling:** `simctl` recording first failed `allocationError`; fixed by bringing
  Simulator.app to the foreground (`open_simulator`), after which recording worked.
- Verified live, screenshot-by-screenshot: 01 session (data loads; survives cold restart), 02 real
  import → preview, 03 add-cookbook both places incl. inline-during-save without leaving the screen,
  04 cookbook list (cover + count), 05 show cookbook (recipe card), 06 tap-ingredient-in-step popover
  with exact amount + haptic, 07 edit steps/ingredients (PATCH round-trip), 08 delete (confirm →
  removed from library AND cookbook).
- Icon resolver confirmed: matched ingredients (olive oil, flour, pepper, bouillon) show painterly
  icons; unmatched (`default`) show the token placeholder chip — no white/broken images.

## Recordings (step 6) — one per story, saved under docs/sprint-import/recordings/
- `spec-01-auth-persistence.mp4` (17s) — cold restart, cookbooks persist ⇒ session restored (story: auth)
- `spec-02-03-import-and-save.mp4` (117s) — import a link → preview → new cookbook inline → save →
  celebration (stories: import, add-cookbook-during-save)
- `spec-03-add-cookbook-from-recipes.mp4` (34s) — FAB → Add a cookbook → create → appears (story: add-cookbook place 1)
- `spec-04-05-cookbooks.mp4` (27s) — cookbook list (cover+count) → open → recipe card (stories: list, show cookbook)
- `spec-06-show-recipe-tap-ingredient.mp4` (42s) — steps with tappable ingredients → popover w/ amount (story: show recipe)
- `spec-07-08-edit-delete.mp4` (102s) — edit an ingredient → save → delete → confirm → gone (stories: edit, delete)

## OpenAPI (step 5 follow-up) — DONE
Added the 6 new routes to `server/src/openapi/document.ts` (extended it to support put/patch/delete
+ 201/204/409) and regenerated `openapi.json`. Also fixed a pre-existing doc bug the pre-mortem
flagged — the session `auth` token shape was documented as a bare string but is `{ jwt, expires_at }`
— and added the previously-undocumented `GET /v1/recipes/{id}`. Server typecheck + all 71 tests green.

## Notes / minor
- Running `npm test` drops+re-migrates the shared `harvest` dev DB (repo design), so it clears any
  data created via the live app. Recordings were captured first, so no impact. The live server
  (my worktree, tsx) is still up on :3000 but its DB was reset by the final test run — restart it
  (`cd server && npx tsx src/index.ts`) before demoing the app again.
- App-side logic (icon resolver, StepText matching, API client) is verified via the live simulator
  run rather than unit tests — the app has no test runner configured and adding one was out of scope.
  The risk-bearing backend logic (COW, membership, delete, collisions) IS unit/integration-tested.
