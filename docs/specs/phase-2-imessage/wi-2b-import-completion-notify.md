# WI-2B — Import completion → save-to-Liked + success/failure reply (finish side)

## Background

WI-2A starts an import when a user drops a recipe link and records an `imessage_import` link row
(`job_id → thread_id`, `target_external_id`, `notified_at`). This work item is the **finish side**:
when that import reaches a terminal state, save the recipe to the user's default "Liked" cookbook and
send the user a success (or failure) message in the thread.

Imports are async (network fetch + LLM extraction — seconds to a couple of minutes), so the reply
cannot happen inside the Chef turn that started it. It must be triggered by the import's completion.

### Verified system context (re-confirm; do not contradict)

- **Workflow** (`src/workflows/import-workflow.ts`): `importWorkflow(input)` → `markRunning` →
  fetch/resolve/enrich → `persistStep` → `persistAndReady` (`src/import-persist.ts:35`) sets the job
  `ready` with `recipeId(s)` in one transaction; `catch` → `markFailed(jobId, code)`
  (`import-workflow.ts:474`). **WDK steps are exactly-once** — a side effect in a dedicated step runs
  once and is cached on replay, so a guarded terminal notify step is safe.
- **Cookbook** (`src/repositories/cookbook-repository.ts`): `ensureSystemCookbook(userId,'liked',
  'Liked')` (idempotent, unique `(user, slug)`) → cookbookId; `addRecipe(userId, cookbookId,
  recipeId)` (idempotent `onConflictDoNothing`). Persist does **not** currently save to Liked.
- **Outbound WITHOUT an inbound trigger:** the consumer (`src/imessage/consumer.ts`) **early-returns
  when `loadPendingInbound` is empty**, so you CANNOT notify by inserting an outbound row + ringing
  the inbound doorbell — the consumer won't send it. Use a **direct send**: resolve the thread's
  `chatGuid` (`ThreadRepository.findById`), `insertOutbound({ threadId, body, messageGuid:
  randomUUID() })`, `selectSender()` → `sender.send(chatGuid, [body])` (returns platform ids) →
  `markSent(rowId, now)` + `setExternalId(rowId, id)` (WI-C).
- **`imessage_import` repo** (WI-2A): `findByJobId(jobId)`, `markNotified(jobId, at)`.

## Objective

On import completion, if the job has an `imessage_import` link and has not been notified: on `ready`,
save the recipe(s) to the user's Liked cookbook and send a success message naming the recipe; on
`failed`, send a failure message. Send via a direct notifier (not the reasoning consumer), stamp
`notified_at` for exactly-once, and no-op for imports with no link (mobile).

## Scope / implementation notes

Follow `server/CLAUDE.md`. Reuse the cookbook repo + `Sender`. No new queue topic, no poller.

1. **Guarded terminal notify** — extend the import workflow so that after `persistAndReady` (ready)
   and in the `markFailed` path (failed), a **dedicated step** runs `notifyImessageOrigin(jobId,
   outcome)`. The step:
   - `imessageImports.findByJobId(jobId)`; if none or `notified_at` already set → **return (no-op)**.
   - on **ready**: `ensureSystemCookbook(userId,'liked','Liked')` then `addRecipe(userId, cookbookId,
     recipeId)` for each recipe id on the job; compose a success message naming the recipe (e.g.
     `Saved "<title>" to your Liked cookbook.`).
   - on **failed**: compose a failure message (e.g. `I couldn't save that recipe — we're looking into
     it.`).
   - **Direct send** the message to the linked thread (resolve `chatGuid`, `insertOutbound`,
     `sender.send`, `markSent` + `setExternalId`).
   - `imessageImports.markNotified(jobId, now)` (exactly-once; belt-and-suspenders with WDK step
     memoization — a redelivery/replay finds `notified_at` set and no-ops).
2. **Thin, guarded notifier** (`src/imessage/…` — a small `ImportNotifier`/service with `static
   create()`): it is iMessage-aware and only acts on jobs with a link. A job with no `imessage_import`
   link (mobile import) → no Liked-save change, no message.
3. **Normal message now; thread later** — send as a **normal** message in Phase 2. The link row's
   `target_external_id` is preserved so **Phase 3** upgrades this to a **threaded reply** to the
   original link message.

`ponytail:` the import workflow calling an iMessage-aware notifier is an accepted, **guarded**
coupling (no-op for non-iMessage imports). Ceiling: if decoupling ever matters, emit a terminal
domain event/topic and move the notifier behind its own consumer.

## Acceptance Criteria

1. Given a ready import with an `imessage_import` link, when the notify step runs, then each recipe is
   in the user's "Liked" cookbook, a success message naming the recipe is sent to the linked thread,
   and `notified_at` is set.
2. Given a failed import with an `imessage_import` link, when the notify step runs, then a failure
   message is sent to the linked thread and `notified_at` is set (no Liked write).
3. Given the notify step runs twice for the same job (replay/redelivery), then exactly one message is
   sent (second call finds `notified_at` set and no-ops).
4. Given an import with **no** `imessage_import` link (mobile), when it completes, then no Liked-save
   change and no message — behavior is unchanged.
5. Migration/behavior: full suite green (`npx vitest run`, 0 failed); typecheck clean.

## Test Cases

### Test Case 1: ready → Liked + success message (AC1)
**Preconditions:** `file:` test DB; a job with an `imessage_import` link + a persisted recipe with a known title; `StubSpectrumSender`.
**Steps:** Invoke the notify step with outcome=ready.
**Expected Outcomes:** the recipe is a member of the user's Liked cookbook; the stub sender recorded one outbound naming the recipe; `notified_at` set.

### Test Case 2: failed → failure message, no Liked write (AC2)
**Steps:** Invoke the notify step with outcome=failed for a linked job.
**Expected Outcomes:** stub sender recorded one failure message; no cookbook membership added; `notified_at` set.

### Test Case 3: exactly-once (AC3)
**Steps:** Invoke the notify step twice for the same job.
**Expected Outcomes:** exactly one send total; second call no-ops.

### Test Case 4: mobile import (no link) is untouched (AC4)
**Steps:** Complete a job with no `imessage_import` row.
**Expected Outcomes:** no message sent; no Liked change from this path.

### Test Case 5: suite (AC5)
**Steps:** `npx vitest run`; `npm run typecheck`.
**Expected Outcomes:** green; clean.

## Test Run

_To be filled during execution._

## Deployment Strategy

Direct deploy — a guarded terminal step + a thin notifier; no schema change beyond WI-2A's link table
(this WI may add nothing to the schema). Restart the dev server on the merged HEAD before the
real-iMessage e2e.

## Production Verification

### Production Verification 1: four real sources save to Liked + reply; broken link fails (REQUIRED)
**Preconditions:** WI-2A + WI-2B merged/deployed; dev server on the merged HEAD; ngrok live; test Mac paired.
**Steps:** From the test Mac, drop one real link from **each** of Instagram, TikTok, YouTube, and a
recipe website. Then drop a deliberately broken/non-recipe link.
**Expected Outcomes:** For each of the four sources — the recipe appears in the user's Liked cookbook
(verify in the live DB) **and** a success message naming the recipe arrives on-device. For the broken
link — a failure message arrives (or, if rejected at classify time, WI-2A's synchronous rejection).
No duplicate messages.

## Production Verification Run

_To be filled during execution._

---

**Dependency:** **WI-2A** (import tool + `imessage_import` link) — branch from WI-2A merged to `main`.
Builds on Phase 1 + WI-C. Phase 3 later upgrades the reply to a threaded reply via `target_external_id`.
