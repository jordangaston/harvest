# Serverless migration — postmortem

What the sprint actually taught, distilled from where it turned. Each lesson is a thing that cost a
cycle or a correction, with what to do next time.

## 1. "In place" means in place — do not build in a sibling directory

The build started in a new `server-edge/` directory to keep the old suite green during the port. The
founder's intent was the opposite: transform the real `server/` in place. The parallel directory
became a hard redirect and a consolidation pass to undo.

**Lesson.** When a migration says "replace X," edit X from the first commit — even if it means the old
tests go red mid-flight. A green old suite is not worth a wrong directory. Confirm the *location* of
the work before writing code, not just its content. (The consolidation was clean because the new code
was self-contained, but the detour was avoidable.)

## 2. The definition of done is the real thing running, not a green offline suite

Two founder corrections pushed the same way: the bar is "works in `vercel dev`" and "the existing e2e
pass against real providers," not "the hermetic suite is green." Offline tests are feedback, not the
finish line. Framing the sprint around offline-green led to an early instinct to stub media and defer
video — exactly the wrong call for a core feature.

**Lesson.** Anchor acceptance to the real end-to-end behaviour the user cares about. Keep fast tests
for speed, but never let "the suite is green" stand in for "the feature works." When in doubt, run the
real thing.

## 3. Read the platform docs before assuming the old architecture ports

The design pivoted Cloudflare → Vercel mid-sprint, and Vercel's primitives are not drop-in analogues.
Workflow DevKit uses `"use workflow"`/`"use step"` directives compiled by Nitro, not a class
entrypoint; Vercel Queues authenticates via OIDC from a linked project and has no local emulator; the
Node runtime kept `jsonwebtoken` and let ffmpeg run in-function (no container). Each of these was
found in the versioned docs, not memory — and memory would have been wrong on all of them.

**Lesson.** For a new or fast-moving platform, read the versioned docs before designing, and re-read
before each story that touches a new primitive. Training data on Vercel/WDK/Queues was stale in every
specific that mattered.

## 4. The blocking external dependency should be escalated first, in parallel

`vercel dev` needs a linked Vercel project for Queues + Workflow. That was identified from the docs
and escalated immediately, while the data layer (which needs neither Vercel nor Turso) was built in
parallel. By the time the import pipeline needed the project, access was provisioned.

**Lesson.** Find the one dependency that gates the critical path, escalate it with a specific ask
(a token, a link command, an account), and keep building everything it does not block. Idle waiting is
the waste; a specific early ask plus parallel unblocked work is the fix.

## 5. Provider reality beats the test's assumptions — but only preconditions may bend

The existing e2e assumed LamaTok + DeepSeek; only Groq + Apify (later + OpenAI) were provided. The
migrated stack scrapes TikTok/Instagram via Apify and extracts via Groq. The founder authorized
swapping the `beforeAll` provider *precondition* while keeping every content assertion intact — the
recipe still has to be real; the provider is an implementation detail.

**Lesson.** When the providers change, adapt the test's environment gate, never its assertions. A test
that still demands "a real TikTok URL produces a real recipe" is provider-agnostic and stays honest.

## 6. Live content drifts; a changed post is data, not a bug

One Instagram case imported a correct recipe, but the real post had changed from chicken to peach
salsa since the assertion was written, so `/chicken/` no longer matched. Five sibling cases through the
same actor + model produced correct recipes — the pipeline was fine.

**Lesson.** e2e tests keyed to live third-party content have a data-drift failure mode distinct from a
code bug. Diagnose which it is (does the same path work on sibling inputs? is the content actually
different now?) before touching code, and log a drifted assertion rather than weakening it.

## 7. Keep the tiered fallback under maximum concurrency

The founder wanted per-frame vision fanned out at max concurrency, but the external VLM has a ~8 k TPM
cap that the old server already hit. The resolution kept both: local Tesseract OCR is the primary
per-frame reader (CPU, no cap, fully parallel across per-frame function invocations), and only a
weak-OCR frame escalates to the VLM, where a 429 throws `RetryableError({ retryAfter })` so the
Workflow engine backs off and retries that one frame — no frame dropped, no shared limiter needed
across isolated invocations. The OpenAI fallback tier (gpt-5.6-luna / whisper-1) hardens this further
against Groq rate limits.

**Lesson.** "Maximum concurrency" and "respect the rate limit" are not in conflict if the common path
is the unlimited one. Fan out the free (local) work; bound only the expensive external escalation, and
prefer the platform's own retry/backoff to a hand-rolled semaphore when invocations cannot share state.

## 8. Serializable-only boundaries shape the workflow design

WDK persists each step result to an event log and passes only serializable data across the
workflow/step boundary. Frames could not cross as `/tmp` file paths (per-invocation) or Buffers; they
cross as base64 (small scaled JPEGs), and the import error travels as a string code inside
`FatalError`, not a class instance. `ffmpeg`'s filtergraph commas also had to be backslash-escaped in
argv — a shell-vs-argv gotcha the tests surfaced.

**Lesson.** Design durable-workflow steps around what the engine can serialize and replay. Return plain
data, encode errors as codes, and verify the real subprocess argv (not just the shell form).

## 9. Port the contract from the authoritative original, and don't invent

The CRUD routes were ported by reading the untouched original `app.ts`, not the task's prose summary.
The summary implied a `DELETE /v1/cookbooks/:id` and a cookbook edit; the real contract has neither, so
they were not built. The reverse also bit: an early port had made `GET /v1/recipes/:id` owner-scoped,
but the original treats recipes as shared — corrected to match, which the ported integration test then
required.

**Lesson.** The source of truth for a port is the code being replaced, read directly. A task's
paraphrase is a pointer, not a spec — verify the exact routes, shapes, and visibility against the
original, add nothing it lacks, and let the original's own tests catch a drifted contract.

## 10. A long migration must reconcile onto a moving `main`, and the merge is a port, not a keep-mine

The branch was cut from a pre-Wave-2 `main`; while the migration ran, `main` gained meal-planning,
grocery, account-deletion, and a shared recipe list. Merging naively would have regressed those
features. The merge's 14 conflicts split cleanly by intent: content conflicts on rewritten files
(keep the new stack, fold in the feature delta), and modify/delete conflicts on old-stack files (stay
deleted, but port the functionality). The old Fastify/Postgres code was the *contract*, not the
implementation — every new route re-implemented on Workers/WDK/Turso, then checked for exact route
parity against `main`.

**Lesson.** On a migration that outlives a few `main` cycles, treat the merge as another porting pass,
not a conflict-clicking exercise: for each incoming feature, keep the target architecture and
re-implement the behaviour, and gate "done" on route/endpoint parity with `main` so nothing regresses.
A cwd-vs-bundle path bug (the catalog seed) and a squashed migration that dropped stale pg-core deltas
were both caught only because the reconcile ended in a real `vercel dev` smoke, not just a green unit
suite.

## What went well

- Reading the versioned docs first meant the WDK/Queues/Turso APIs were right the first time.
- Escalating the Vercel-project dependency early kept the critical path moving.
- The data layer's interactive-transaction atomicity, proven offline in S1, carried straight through —
  the one part reused verbatim from the spike.
- Resume-not-restart and the per-frame fan-out were both demonstrated on real runs, not just asserted.
