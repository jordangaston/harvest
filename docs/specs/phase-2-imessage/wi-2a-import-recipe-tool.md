# WI-2A — Chef `import_recipe` tool + iMessage-origin link (start side)

## Background

When a user drops an Instagram / TikTok / YouTube / recipe-website link into the Chef thread, Chef
should ingest it through the **existing** import pipeline and (WI-2B) save it to the user's default
"Liked" cookbook. Today nothing handles a dropped link — the onboarding objective even promises
"Drop a recipe link here anytime and I'll save it" (`src/chef/objectives/onboarding.ts`) but there
is no handler.

This work item is the **start side**: give the reasoner a tool that classifies a dropped URL, starts
an import for the thread owner, and records that this import came from an iMessage thread (so WI-2B
can send the success/failure reply back to that thread). A dropped link arrives as an inbound `text`
message whose body is the URL (confirmed in Phase 1's rich-link spike).

### Verified system context (re-confirm; do not contradict)

- **ImportService** (`src/import-service.ts`): `static create()` wires db; instance
  `create(userId: string, source: SourceInput): Promise<PublicJob | null>` — classifies, writes an
  `importJobs` row (`status='queued'`), enqueues `IMPORT_TOPIC` (idempotencyKey = jobId), returns a
  `PublicJob` (or `null` if not importable). Do **not** write a second parser — reuse this.
- **classifySource** (`src/classify.ts:22`): normalizes the URL and maps it to a platform enum
  (tiktok/instagram/facebook/pinterest/youtube/website); returns `null` for a non-recipe/profile/
  invalid URL. This is the **synchronous reject** path.
- **Chef tools** (`src/chef/tools/`): `ChefTool { id, saved[], canRun(), asMastraTool() }`; registry
  `FACTORIES` + `buildTools(ctx, toolIds)`. `TurnContext` (`src/chef/tools/types.ts`) has
  `{ db, threadId, objectiveId, initiatorHandle, householdId, members }` — **not** `initiatorUserId`.
- `TurnContext` is assembled in `src/imessage/chef.ts` from `thread.ownerUserId`; the triggering
  inbound message (the one carrying the URL) is available in that turn and now carries its platform
  id in `thread_messages.external_id` (WI-C).

## Objective

Add a Chef `import_recipe` tool that (1) rejects a non-recipe URL synchronously, (2) starts an import
via `ImportService` for the thread owner on a valid URL, and (3) records an `imessage_import` link
row associating the started job with this thread and the triggering message's platform id — so WI-2B
can reply on completion and Phase 3 can thread that reply.

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse `ImportService` + `classifySource`. Model the origin as a **link
table**, not columns on `import_jobs`.

1. **`TurnContext.initiatorUserId`** — add it (from `thread.ownerUserId`) where `TurnContext` is
   built in `src/imessage/chef.ts`. Also expose the **triggering message's `external_id`** to the
   turn/tool (the inbound message that carried the URL) so the link row can store it. `[ASSUMPTION:
   the trigger message is the newest pending inbound `text` for the turn; use its `external_id`.]`
2. **`imessage_import` link table** (drizzle migration): `job_id` (text, FK `import_jobs`, **unique**),
   `thread_id` (text, FK `threads`), `target_external_id` (nullable text — the link message's
   platform id, for Phase-3 threading), `notified_at` (nullable timestamp — WI-2B stamps it),
   `created_at`. Add a Zod model (`src/models/…`) and a repository with `static create()`
   (`insert(...)`, `findByJobId(jobId)`, `markNotified(jobId, at)`). Keep `import_jobs` unchanged.
3. **`import_recipe` tool** (`src/chef/tools/import-recipe.ts`, `ChefTool`, `static create(ctx)`):
   input `{ url: string }`. `execute`:
   - `classifySource({ url })` → if `null`, return a rejection result (no job) that makes the reasoner
     tell the user it isn't a recipe link.
   - else `ImportService.create().create(ctx.initiatorUserId, { url })`; if it returns a job, insert
     an `imessage_import` row `{ job_id: job.id, thread_id: ctx.threadId, target_external_id: <trigger
     external_id>, notified_at: null }`, push a `SaveResult` (`{ job_id }`), and return success so the
     reasoner can briefly acknowledge ("On it — reading that recipe…").
   - `canRun()`: `true` when `ctx.initiatorUserId` is present (importing is allowed anytime, not gated
     on onboarding).
   - Register in the tools registry and include it in the reasoner's available tools.

Out of scope (WI-2B): saving to "Liked", and the success/failure reply on completion. Out of scope
(Phase 3): sending the reply as a *threaded* reply — this WI only **stores** `target_external_id`.

## Acceptance Criteria

1. Given a valid recipe URL dropped in the thread, when the reasoner calls `import_recipe`, then an
   import job is started (`ImportService.create` invoked with the thread owner's userId) and an
   `imessage_import` row exists linking `job_id → thread_id` with `target_external_id` = the trigger
   message's `external_id` and `notified_at = null`.
2. Given a clearly non-recipe/invalid URL, when `import_recipe` runs, then `classifySource` returns
   null, **no** job and **no** link row are created, and the tool returns a rejection the reasoner
   relays as a failure message.
3. `TurnContext.initiatorUserId` is populated from `thread.ownerUserId` for every turn.
4. Migration applies forward cleanly; full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: valid link starts a job + link row (AC1, AC3)
**Preconditions:** Integration app on a `file:` test DB; `ImportService` (or the queue) stubbed offline so no network; a thread with a known owner user.
**Steps:** Deliver an inbound `text` webhook whose body is a valid recipe URL; drain the consumer so the reasoner runs `import_recipe` (or unit-invoke the tool with the built `TurnContext`).
**Expected Outcomes:** a job was started for the owner userId; an `imessage_import` row exists with `job_id`, `thread_id`, `target_external_id` = the URL message's `external_id`, `notified_at` null.

### Test Case 2: non-recipe URL rejected synchronously (AC2)
**Preconditions:** As TC1.
**Steps:** Invoke `import_recipe` with a profile/root or non-recipe URL (`classifySource` → null).
**Expected Outcomes:** no job, no `imessage_import` row; the tool returns a rejection result.

### Test Case 3: suite + migration (AC4)
**Steps:** `npm run db:migrate`; `npx vitest run`; `npm run typecheck`.
**Expected Outcomes:** migration applies; suite green; typecheck clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — one additive link table + a new tool; no change to `import_jobs` or the workflow.
Forward-only migration. Restart the dev server on the merged HEAD before real-iMessage verification.

## Production Verification

### Production Verification 1: valid + invalid link, on a real device (REQUIRED)
**Preconditions:** Dev server restarted on the merged HEAD; ngrok live; test Mac paired.
**Steps:** From the test Mac, drop a valid recipe link (e.g. a YouTube recipe video). Separately, drop
a clearly non-recipe URL (e.g. `https://example.com`).
**Expected Outcomes:** For the valid link — the live DB shows an `imessage_import` row for a started
job (`thread_id` = this thread, `target_external_id` = the link message's `external_id`). For the
invalid URL — no job/link row, and Chef replies that it isn't a recipe link. (The success message on
completion is WI-2B.)

## Production Verification Run

_To be filled during execution._

---

**Dependency:** builds on Phase 1 + WI-C (merged to `main`). **WI-2B branches from this item merged.**
