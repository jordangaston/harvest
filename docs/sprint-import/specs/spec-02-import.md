# Spec 02 — Import a recipe from a link

## Background
The user imports a recipe from a web, Pinterest, Instagram, TikTok, or YouTube link. Backend flow:
`POST /v1/imports { source:{ url } }` → `202 { job }` (status `queued|running|ready|failed`,
`progress`, `source_type`, `error_code?`, `recipe_id?`). Poll `GET /v1/imports/:id` until `ready`
(→ `recipe_id`) or `failed` (→ `error_code`). Fetch the recipe with `GET /v1/recipes/:id`. Import
auto-saves the recipe to the user's library (`saved_recipes`); filing it into a cookbook is spec 03.

**Locked divergence from Recime:** NO in-app browser. The user taps **+**, pastes a link into a
simple modal, and the import **starts automatically** on submit/paste — then the preview/save screen.

## Objective
Wire the real import API behind a paste-link modal with an auto-starting import, a loading state, a
preview screen, and friendly errors — replacing the current fake importer.

## Acceptance Criteria
- AC1: Given the Recipes screen, when the user taps the **+** FAB and chooses "Import from a link",
  then a modal opens with a single URL field and an Import action. Surfaces use `bg-card` (no
  `bg-white`); FAB/primary use `bg-brand`; `<Backdrop />` renders behind.
- AC2: Given a valid recipe link, when the user pastes it and submits (or on valid paste), then the
  app POSTs the import, shows a golden-hour loading state, polls the job, and on `ready` navigates
  to the preview screen showing title, hero image, and per-ingredient icons.
- AC3 (invalid/no-recipe): Given a 404/unsupported link or a job that ends `failed` with a
  "no recipe" class error, then the app shows: **"We don't think this contains a recipe."**
- AC4 (timeout/failure): Given the import times out or fails for other reasons, then the app shows:
  **"Oops let's try that again"** with a retry affordance.
- AC5: Given the preview screen, when the user taps Save, then the recipe is filed per spec 03 and
  the success celebration ("Now you're cooking!") shows, then returns to Recipes with the recipe in
  the library.
- AC6: All five source types (website, pinterest, instagram, tiktok, youtube) route through the same
  `{ source:{ url } }` call; source detection is the server's job.

## Touches
- Rework `app/import.tsx` → paste-link modal (drop the source-picker/in-app-browser direction).
- Rework `app/importing.tsx` → real POST + poll loop + error routing (drop the 2.4s fake).
- `app/recipe/[id].tsx` preview/save mode (shared with spec 06).
- New: `lib/api/imports.ts` (create + poll), `lib/api/recipes.ts` (fetch).
- Error copy centralized so strings match exactly.

## Error mapping (confirmed against `import-pipeline.ts` / `enums.ts`)
Real job `failed` error_codes: `NO_RECIPE`, `FETCH_FAILED`, `MEDIA_UNAVAILABLE`, `EXTRACTION_FAILED`.
`UNSUPPORTED` is the POST-time **422** (before any job). `TIMEOUT` exists in the enum but is **never
thrown** — there is no server-side timeout, so the client owns the timeout.
- **"We don't think this contains a recipe."** ← job `failed` with `NO_RECIPE`, OR POST `422`/`400`.
- **"Oops let's try that again"** ← `FETCH_FAILED` / `MEDIA_UNAVAILABLE` / `EXTRACTION_FAILED`,
  network error, OR the client poll budget (~120s) elapses while still `queued|running`.
- Imports can take minutes (vision pacing); poll every ~1.5s while `queued|running`, budget ~120s,
  drive the progress bar from `job.progress`.

## Test Cases
### Test Case 1: Happy path (each platform)
**Preconditions:** Session active; server+keys up. Use e2e links (Instagram/TikTok/Pinterest/
YouTube/website) from `server/tests/e2e/*`.
**Steps:** + → Import from a link → paste link → Import.
**Expected Outcomes:** Loading → preview with title+image+ingredient icons; job reached `ready`.

### Test Case 2: Invalid link → friendly no-recipe error
**Preconditions:** Session active.
**Steps:** Paste `https://example.com/not-a-recipe` → Import.
**Expected Outcomes:** "We don't think this contains a recipe."; user can dismiss/retry.

### Test Case 3: Timeout/failure → try-again error
**Preconditions:** Force a failure (server down or a URL that errors).
**Steps:** Import.
**Expected Outcomes:** "Oops let's try that again" with retry.

### Test Case 4: Auto-start on submit
**Preconditions:** Modal open.
**Steps:** Paste a valid link and submit.
**Expected Outcomes:** Import starts without a second confirmation step (no browser).

## Test Run
_To be filled during execution._

## Deployment Strategy
Client change against the live API. Guard with the friendly-error paths so a flaky import never
hard-fails the UI.

## Production Verification
### Production Verification 1: Real import end-to-end
**Preconditions:** Prod-like server.
**Steps:** Import one real Instagram reel link.
**Expected Outcomes:** Preview renders a coherent recipe; Save persists it.

## Production Verification Run
_To be filled during execution._
