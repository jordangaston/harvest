# Sprint Report — Recipe Import

**Goal:** wire the backend import API into the Harvest app and complete the import, cookbook, and
recipe user stories. **Outcome: all 8 stories shipped and verified live.**

## What shipped

**All 8 stories pass**, verified in the iOS simulator against the live backend (a real
`thecozycook.com` import exercised the full extraction pipeline):

| Story | Status | Proof |
|---|---|---|
| User creation & auth (silent provision + refresh) | ✅ | `spec-01-auth-persistence.mp4` |
| Import from a link (paste modal → auto-import, no browser) | ✅ | `spec-02-03-import-and-save.mp4` |
| Add a cookbook (both entry points, inline during save) | ✅ | `spec-02-03…`, `spec-03-add-cookbook-from-recipes.mp4` |
| List cookbooks on the recipe screen (+ empty state) | ✅ | `spec-04-05-cookbooks.mp4` |
| Show cookbook (recipe cards) | ✅ | `spec-04-05-cookbooks.mp4` |
| Show recipe (tap ingredient in a step → amount + haptic) | ✅ | `spec-06-show-recipe-tap-ingredient.mp4` |
| Edit recipe (steps & ingredients) | ✅ | `spec-07-08-edit-delete.mp4` |
| Delete recipe | ✅ | `spec-07-08-edit-delete.mp4` |

The locked divergence held: import is **paste-into-a-modal → auto-import**, never Recime's in-app
browser. The whole app uses the golden-hour tokens (no `bg-white`; `bg-card` surfaces, amber
`bg-brand`, Lora wordmark), with a token placeholder wherever an ingredient icon or recipe image is
missing.

Scope grew mid-sprint by the reviewer's choice: the backend had **no** endpoints for cookbooks, the
saved-recipe library, save-to-cookbook, or recipe edit/delete. We **built them** rather than fake it
client-side.

**Backend (new):** `cookbooks` + `cookbook_recipes` tables and migrations; `POST/GET /v1/cookbooks`,
`GET /v1/cookbooks/:id`, `PUT /v1/recipes/:id/cookbooks`, `PATCH` + `DELETE /v1/recipes/:id`; a widened
recipe projection (`quantity_text`/`amount`/`unit`); OpenAPI regenerated. 71/71 tests green.

**App (new):** a full API client (silent user provisioning, `expo-secure-store` tokens, 401 → refresh
→ retry); the paste-link import modal with real polling and friendly errors; the Recipes cookbook
list; the cookbook detail screen; and a recipe screen doing preview, save-to-cookbook, tap-ingredient
popovers with haptics, edit, and delete. App typechecks clean.

## What went well

- **The pre-mortem earned its keep.** It caught the one bug that would have broken every request —
  the auth token is nested (`auth.access_token.jwt`), not the bare string the stale OpenAPI showed —
  plus the real import error-code taxonomy, the icon-`default` gap, and the migration ordering. A
  cheap step that removed the most expensive class of rework.
- **Verify against reality, not the spec.** The checked-in `openapi.json` was stale on the token
  shape and missing `GET /v1/recipes/:id`. Confirming the live server (`curl`, then the running app)
  before wiring saved hours.
- **The domain stayed clean under pressure.** Recipes are shared, so edit is copy-on-write (fork only
  when another user also saved it) and delete is library-only — the canonical row survives. Both are
  covered by isolation tests.
- **Backend confidence.** Every risk-bearing path — collision (409), copy-on-write fork vs. in-place,
  delete scoping, membership — has a unit or integration test. Bugs surfaced in the test loop
  (Drizzle wraps pg errors in `.cause`; a new FK broke sibling teardowns; Fastify needs
  `reply.code(204).send()`), not in the simulator.

## What to improve

- **Ingredient-in-step matching is a heuristic** (strip leading quantity/units, match the longest
  remaining phrase). It handled the real recipe well but will miss plurals and synonyms. The clean
  fix is a server-provided step→ingredient index; do it when accuracy matters.
- **Parsed amounts aren't populated on import.** The pipeline stores each ingredient as a full line
  with `amount`/`unit` null, so the tap popover shows the line text (which contains the amount). Fine
  today; parse amounts server-side to power scaling/unit-conversion later.
- **Remote recipe images are hotlinked over the source CDN.** They loaded here, but hotlink
  protection or cleartext will eventually break one; the `onError` placeholder covers it. Re-host to
  https object storage (the repo's deferred BR-07) before it bites in production.
- **No app-side test runner.** Client logic (icon resolver, `StepText`, API client) was verified in
  the simulator, not unit tests. Add Jest/RNTL if the client logic grows.
- **Dev/test share one database.** `npm test` drops the dev DB, wiping live app data. A separate
  `harvest_test` database would let the dev server and the suite coexist.
- **Auth is intentionally minimal.** Silent provisioning with a generated phone and no login UI is
  right for this sprint but isn't real identity — wire OTP sign-in before accounts must survive a
  reinstall or move between devices.

## Follow-ups before ship

- Re-host recipe images to https (BR-07).
- Restart the live server after the final test run reset its DB.
- Decide whether the Recipes tab should also show a flat "all recipes" list (Recime does); today it
  shows cookbooks only, which satisfies the stories.
