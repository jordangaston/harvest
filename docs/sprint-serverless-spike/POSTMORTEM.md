# Postmortem — serverless migration spike

What was harder than expected, and the lessons worth keeping.

## What went well

- **Answering with a runnable proof, not prose.** The freeze→recover demo turned an abstract
  "durable execution needs a live process" claim into a table anyone can reproduce in 30 seconds.
- **Reading the installed package, not memory.** Confirmed the DBOS 4.25.14 API and the
  `(executorID, appVersion)` recovery scoping from the SDK's own types and admin server, so the
  recommendation rests on the pinned version, not a blog.
- **Isolation held.** All new code lives in `server/spike/`; production `src/` diff is empty and
  the suite stayed 86/86 green and offline.

## What bit us

### 1. The recovered import failed until the worker registered the workflow

First run: the recovered job landed `failed` (`NO_RECIPE`). The workflow reached `SUCCESS` but the
pipeline produced nothing. Cause: the `recover` process imported only `bootstrap.js`, not the
workflow/pipeline modules, so DBOS recovered the checkpoint against a half-registered workflow.
The real server registers everything transitively via `buildApp`. **Lesson:** a DBOS worker must
import the workflow + step modules *before* `DBOS.launch`, or recovery runs a degraded shell.

### 2. A stub that gates on `NODE_ENV` at step runtime misbehaves under recovery replay

Even after registering the workflow, a **TikTok** source still recovered to `NO_RECIPE`: the
checkpointed `fetchSource` came back empty. The website stub is chosen as a module-const at import
(`const website = selectWebsiteFetcher()`); the TikTok stub is chosen at step runtime
(`selectTikTokFetcher()` inside the step). Under DBOS's recovery replay the runtime selection
resolved to the *live* fetcher and hit a blocked network, while an in-process run of the identical
import yielded a recipe. **Lesson:** environment-gated selection evaluated *inside* a replayed step
is fragile; a module-const captured at import is deterministic. This is a test-stub timing quirk,
not a product defect — but it cost a debug cycle chasing "why does inline work and recovery
doesn't." The proof uses a website source to keep the demo about DBOS, not stubs.

### 3. Longer serverless timeouts almost muddied the verdict

Vercel now offers 30-minute functions, which superficially defeats the "imports exceed the
timeout" argument. The real blocker is deeper — request-scoped compute can't host detached durable
work or run recovery — so the timeout number is a red herring. **Lesson:** state the *structural*
reason, not the convenient metric, or the recommendation dies the day the platform raises a limit.

## Distilled principles (candidates for `docs/harvest-principles.md`)

- **Durable-execution engines assume an always-on executor.** Before putting one on ephemeral
  compute, ask where the recovery scan runs and who owns the executor identity — not just whether a
  single job fits the timeout.
- **Prove the blocker on the real runtime, offline.** A faithful local emulation (real engine, real
  DB, stubbed providers) can demonstrate an architectural blocker without a paid deploy.
- **A DBOS worker registers workflows before launch.** Recovery against an unregistered workflow
  silently degrades.
- **Gate offline stubs at import, not inside a replayed step.** Runtime selection can resolve
  differently under durable-execution replay.
