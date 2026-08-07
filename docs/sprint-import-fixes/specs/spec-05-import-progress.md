# Spec 05 — Import progress advances truthfully

## Background
`progress` is written only at 10 (`markRunning`) and 100 (terminal) in `import-workflow.ts`; the
pipeline stages never bump it, so a running import sits at 10% for its whole (multi-minute)
duration. The client `importing.tsx` drives its bar straight from `job.progress`, so it reads stuck.

## Objective
The progress indicator moves steadily while an import runs and completes at 100%.

## Acceptance criteria
- AC1 (backend, light): add coarse per-stage progress checkpoints in the pipeline — e.g. 25 after
  fetch, 55 after transcribe/ASR, 80 after vision/extract — written via a small jobId-scoped
  transaction that matches the DBOS "status writes commit with the checkpoint" convention. The
  workflow still owns 10 (running) and 100 (terminal).
- AC2 (client, honest smoothing): while `status` is `queued|running`, the client eases the displayed
  bar upward from the last known `progress` toward a ceiling (~90%) so it always visibly moves
  between polls, then snaps to 100 on `ready`. Never shows a stalled bar; never claims 100 early.
- AC3: If the coarse backend checkpoints prove too invasive for the DBOS convention, ship the
  client smoothing alone and LOG that backend per-stage progress was deferred — the bar still moves.
- AC4: No regression to import success/failure handling or the 120s poll budget.

## Touches
- `server/src/pipeline/import-pipeline.ts` + `import-workflow.ts` (optional `setProgress` transaction
  + calls between stages).
- `app/importing.tsx` (eased progress animation between polls).

## Test cases
1. Live: import a slow source (video) → the bar advances visibly throughout, not stuck at 10%.
2. Backend unit: pipeline calls the progress writer after each stage (mock the writer).

## Verification
Verify visually in the simulator during a real import.
