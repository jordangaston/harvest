# WI-03: Import intake + job model — POST /v1/imports, DBOS pipeline skeleton, polling

## Background

With auth in place (WI-02) and the scaffold + `import_jobs` table + DBOS runtime in place (WI-01), this ticket
builds the **import intake and async job model** — the backbone the parse pipeline (WI-04/WI-05) plugs into.
It implements the F-03 intake steps, the F-06 polling flow, and the O-08 workflow *skeleton* (real status/
progress transitions with the fetch/parse steps stubbed), plus O-01 source resolution.

Design references: `docs/core-design.md` — the F-03 and O-08 sequence diagrams, the "Durable execution: DBOS"
decision (**`import_jobs` writes are DBOS transactions**, atomic with the workflow checkpoint), the APIs section
(`POST /v1/imports`, `GET /v1/imports/:id`), and O-01/O-08 in `docs/core-use-cases.md`. Fixture URLs for
`resolveSource` testing: `docs/test-fixtures.md`.

Builds on WI-01/WI-02 conventions: `buildContainer` composition root (no DI), Fastify v5 `buildApp` + routes,
`authGuard` (WI-02), the DBOS `DrizzleDataSource` (`appDataSource`) + `pipeline/bootstrap.ts` from WI-01, Zod
request schemas + typed-error mapping (WI-02), Vitest unit + integration projects. The `import_jobs` table
already exists (WI-01) — **no migration**.

**Out of scope (later tickets):** real media fetch/oEmbed/Apify (WI-04), ASR/vision/extraction/persistence
(WI-05), mobile client (WI-07). In WI-03 the workflow's parse step is an **injectable stub** that returns a
sentinel terminal outcome, so the *shape*, the transactional status transitions, and polling are exercised end-
to-end without real parsing.

[ASSUMPTION: the queued-job insert and the `DBOS.startWorkflow` enqueue are made atomic via DBOS's
transactional-enqueue pattern so there's never an orphan job or a started workflow without its row — implement
per current DBOS docs; if that pattern isn't available, insert-then-start with the workflow tolerant of a
missing/duplicate row (idempotent first checkpoint).]

**Read current docs before coding:** DBOS TypeScript — `DBOS.startWorkflow` / enqueue, running steps, updating
app tables inside `appDataSource.runTransaction` from within a workflow, deterministic/idempotent workflow IDs,
and transactional enqueue. Fastify v5 route params/validation.

## Objective

Deliver: `resolveSource` (O-01), an `ImportService` that atomically creates a queued `import_jobs` row and
enqueues a DBOS import workflow, a DBOS workflow skeleton that transitions `queued → running → {ready|no_recipe|
failed}` writing every status/progress change through `appDataSource.runTransaction` (atomic with the
checkpoint), and the two endpoints `POST /v1/imports` + `GET /v1/imports/:id` (auth-guarded, owner-scoped) —
all covered by Vitest unit + integration tests with the parse step stubbed.

## Acceptance Criteria

1. **Source resolution (O-01).** Given a share payload, pasted URL, or image ref, when `resolveSource` runs,
   then it returns `{ sourceType, platform, normalizedUrl | imageRef }` with `platform ∈ {instagram, tiktok,
   facebook, pinterest, website, photo, unsupported}`; it normalizes URLs (strips tracking params, expands
   `fb.watch`/short links) and classifies non-URL/non-image input as `unsupported`.
2. **Create import (F-03 intake).** Given an authenticated user and a supported source, when `POST /v1/imports
   {source:{url|share_payload|image_ref}}`, then a `import_jobs` row is created with `status='queued'`,
   `user_id`=caller, `source_type`, `source_ref`; a DBOS import workflow is enqueued for that job id; and the
   response is `202 {job:{id, status:'queued', source_type}}`.
3. **Atomic enqueue.** Given intake, when the queued row is written and the workflow enqueued, then either both
   happen or neither (no orphan job with no workflow; no workflow referencing a missing row) — verified by the
   row existing exactly when the workflow is scheduled.
4. **Unsupported source.** Given an unsupported/unrecognized source (e.g. a plain profile link or junk text),
   when `POST /v1/imports`, then `422 {error:{code:'UNSUPPORTED', ...}}` and no job row is created.
5. **Transactional status transitions.** Given the enqueued workflow runs, then it writes `status='running'`
   (and `progress` updates) and a terminal status via **`appDataSource.runTransaction`** — each write commits
   atomically with the DBOS checkpoint. On worker crash mid-run, the workflow resumes from the last completed
   step and does not double-apply a transition (idempotent).
6. **Terminal states via the (stubbed) parse step.** Given the injectable parse step returns `ready`,
   `no_recipe`, or `failed(reason)`, then the workflow persists that terminal `status` (+ `reason` on failure,
   + `recipe_id` when a later ticket produces one) and stops. In WI-03 the default stub returns a sentinel
   terminal outcome (documented) so no real parsing is implied.
7. **Poll status (F-06).** Given a job the caller owns, when `GET /v1/imports/:id`, then `200 {job:{id, status,
   progress, reason?, recipe?}}` reflecting the current state; polling repeatedly shows the `queued → running →
   terminal` progression as the workflow advances.
8. **Ownership.** Given a job id that belongs to a different user (or doesn't exist), when `GET /v1/imports/:id`,
   then `404` (no cross-user leakage). Both endpoints require a valid access token (`authGuard`); no token → 401.
9. **No secret/PII leak.** Job responses expose only `{id,status,progress,source_type,reason?,recipe?}` — never
   internal fields, and no source credentials.

## Test Cases

### Test Case 1: resolveSource table (AC-1) — unit
**Preconditions:** none (pure).
**Steps:** Run `resolveSource` over representative inputs from `docs/test-fixtures.md`: a TikTok URL, an IG
`/p/` and `/reel/` URL, an `fb.watch` short link + a `/reel/` URL, a Pinterest `/pin/` URL, a plain recipe-blog
URL, an image ref, and junk (`"hello"`, an IG *profile* URL).
**Expected:** Correct `platform`/`sourceType` for each; URLs normalized (tracking stripped, `fb.watch` expanded);
junk + profile URL → `unsupported`.

### Test Case 2: Create → 202 + queued row + enqueue (AC-2, AC-3) — integration
**Preconditions:** Authenticated user (via WI-02 flow or a seeded user + minted token).
**Steps:** `POST /v1/imports {source:{url:"<tiktok fixture>"}}` with a Bearer token.
**Expected:** `202 {job:{id,status:'queued',source_type:'tiktok'}}`; a `import_jobs` row exists for the caller
with `status='queued'`; a DBOS workflow is scheduled for that id (assert via the workflow running/advancing).

### Test Case 3: Workflow drives transitions to terminal (AC-5, AC-6, AC-7) — integration
**Preconditions:** Parse step stub injected to return `no_recipe` (and a second run with `ready`).
**Steps:** Create an import; poll `GET /v1/imports/:id` until terminal.
**Expected:** Observed progression `queued → running → no_recipe` (and `→ ready` in the second run); `progress`
advances; terminal fields correct; every status write was inside `appDataSource.runTransaction` (assert via a
transactional-write assertion or by crash-resume determinism in TC-6).

### Test Case 4: Unsupported source → 422 (AC-4) — integration
**Steps:** `POST /v1/imports {source:{url:"https://instagram.com/someprofile"}}` and `{source:{share_payload:{text:"hi"}}}`.
**Expected:** `422 {error:{code:'UNSUPPORTED'}}`; zero new job rows.

### Test Case 5: Ownership + auth (AC-8) — integration
**Preconditions:** Two users A and B; A owns job J.
**Steps:** B `GET /v1/imports/J`; then unauthenticated `GET /v1/imports/J`.
**Expected:** B → `404`; unauthenticated → `401`. A → `200`.

### Test Case 6: Crash-resume idempotency (AC-5) — integration
**Preconditions:** A workflow whose parse step is slow/instrumented so we can restart the DBOS runtime mid-run
(reuse the WI-01 harness pattern for resume).
**Steps:** Start an import; simulate a mid-run restart; let it complete.
**Expected:** The job reaches its terminal state exactly once; no duplicated status transition or double side-
effect; final `status`/`progress` consistent.

### Test Case 7: resolveSource + ImportService unit (AC-1, AC-2) — unit
**Steps:** Unit-test `ImportService.create` with a stub repo + stub workflow-trigger + stub `resolveSource`:
supported source → inserts queued row + triggers enqueue + returns `{id,status,source_type}`; unsupported →
throws the `UNSUPPORTED` typed error, no insert/enqueue.

## Test Run

_To be determined (filled in during execution)._

## Deployment Strategy

Backend on the existing Railway staging service (stacked on WI-01/WI-02). No new env beyond WI-01/WI-02
(the parse step is stubbed; Apify/Groq/Qwen keys arrive in WI-04/WI-05). No migration. No feature flag (no
user-facing surface until WI-07). Rollback = redeploy previous image. Note the **Q-08** staging follow-up still
applies (DBOS keeps Neon warm; confirm pooled/direct endpoint) — this ticket is the first to run a *real*
multi-step workflow, so it's a good staging checkpoint for Q-08.

## Production Verification

### Production Verification 1: End-to-end intake + poll (stubbed parse)
**Preconditions:** Deployed to staging; a verified user + access token.
**Steps:** `POST /v1/imports` with a TikTok fixture URL; poll `GET /v1/imports/:id` to terminal.
**Expected:** `202` + `jobId`; polling shows `queued → running → <terminal>`; the DBOS Conductor/console shows
the workflow ran with transactional status writes; no orphan jobs.

### Production Verification 2: Ownership isolation
**Steps:** With a second user's token, `GET /v1/imports/:id` for the first user's job.
**Expected:** `404`.

## Production Verification Run

_To be determined (filled in during execution)._
