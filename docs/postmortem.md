---
title: "Implementation Pass — Feedback Postmortem"
status: living
purpose: "Track review feedback during the backend build so we can harden team standards and stop repeating over-engineering mistakes."
---

# Implementation Pass — Feedback Postmortem

A running log of feedback from code review during the Harvest backend build. Each entry: the smell,
the rule it broke, the fix. We fold the recurring ones into standards at the bottom.

## The core lesson (why these keep happening)

**Stop engineering for contingencies that dev, test, or pre-launch verification catch for free.**
The instinct to defend against every failure mode at runtime *adds* complexity and *reduces* clarity.
Most "what if X is misconfigured?" questions are answered by a failing test or a smoke check before
launch — not by shipping self-diagnosing code. Build the straight line; catch the rest at the boundary.

> Poster child: `pingWorkflow` — a fake DBOS workflow that inserted a garbage user row on boot just to
> ask "is DBOS running?" at runtime. If DBOS is misconfigured, a test fails. The workflow was pure
> ceremony, and it wrote junk data to do it.

## The durable-pipeline architecture (WI-03 — the highest-leverage lesson)

A DBOS workflow and the work it drives are **two concerns**. Keep them apart.

**The workflow's only jobs:**
1. Set the job status to `running`.
2. Set the terminal status (`ready` + recipe, or `failed` + error code).
3. Handle exceptions thrown by the work → `failed`.

That's it. The workflow is a thin orchestrator you can read in ten lines.

**The work (fetch → transcribe → vision → extract → persist) is a separate concern,
decomposed into one DBOS `step` per network call.** DBOS memoizes a completed
step, so on a retry/resume it is **not** re-run. If the whole import is one
function inside one step, a failure in the *last* stage re-runs *every* network
call before it — wasteful and often non-idempotent. Model each expensive stage
as its own step so only the failed (and later) stages re-run. Run the separation
against SRP: one responsibility per step, the workflow just sequences them.

> Poster child (this pass): `parse-provider.run()` did fetch + ASR + vision +
> extract + persist in a single function behind one step — so a persist failure
> would re-fetch and re-transcribe from scratch. Wrong. Decompose into steps.

**Make the workflow unit-testable by mocking its steps.** Per the DBOS testing
guide, unit-test the workflow logic in isolation: mock the step functions, assert
the workflow set `running`, then set `ready(recipeId)` on success or
`failed(code)` when a step throws. A module-scoped `ImportJobRepository.create()`
baked into the workflow file makes this impossible — the test can't substitute
it, so you're forced into a heavy real-DBOS+real-repo test. Put the status writes
and the work behind mockable step modules; the workflow depends on those, not on
a concrete repo instance. **Never test DBOS's own guarantees** (crash recovery,
exactly-once) — that's DBOS's test suite, not ours.

## Standing practices (read + apply on every task)

1. **`/quality-software-manifesto`** — read before writing or designing. The load-bearing bits here:
   *Keep things small* (writing small takes more effort; delete aggressively — small programs change
   faster), *Expect failure* (use fault-tree analysis to find and **prioritize** failure modes — not to
   guard all of them), *Prefer type-driven design* (let the schema/compiler exclude bad states, e.g.
   model the domain right instead of enumerating edge validations).
2. **`/ponytail:ponytail`** — the lazy-senior ladder, run *after* understanding the problem: does this
   need to exist at all (YAGNI) → is it already in the codebase → stdlib → native/platform → an
   installed dep → one line → only then, minimum code. Deletion over addition. Shortest working diff.
3. **`server/CLAUDE.md`** — the actionable backend conventions (db singleton, classes + `static create()`,
   Zod domain models, migrations-only, cursor pagination, ≤10-line methods). Auto-loaded when working in
   `server/`; keep it current as standards evolve.

## Anti-patterns to avoid (each cost a review comment this pass)

| Anti-pattern | Rule broken | Do instead |
|---|---|---|
| **Runtime self-checks for infra that tests catch** (`pingWorkflow` proving DBOS is up) | Expect-failure ≠ guard-every-mode; YAGNI | Catch it in a test / pre-launch smoke; delete the runtime ceremony. |
| **Pulling infra in a ticket before anything uses it** (full DBOS bootstrap in the scaffold PR, when the first workflow is 2 tickets later) | YAGNI; keep things small | Introduce infrastructure in the ticket that first *uses* it. |
| **Following a vendor's fancy path when the plain one works** (`@neondatabase/serverless` + `ws` WebSocket driver — Neon is just Postgres over TCP; plain `pg` serves local *and* Neon) | Ladder rung: installed dep / native covers it | Do the boring thing; the exotic driver is for edge runtimes we don't run. |
| **Re-implementing what the tool ships** (hand-rolled `migrate.ts` CLI when `drizzle-kit migrate` exists) | Stdlib/tool does it | Use the tool. Keep only the thin bit it can't do (per-test DB migrate). |
| **Speculative runtime behavior** (migrations-on-boot "to be safe") | YAGNI | Migrations are a deploy step. Don't run them on every boot. |
| **Tests that assert the obvious** (a unit test that Zod parses env; an inject test of a 3-line health route) | Keep things small; YAGNI on tests | Test non-trivial logic. Delete trivial tests. |
| **Comments longer than the code** (JSDoc restating what the code plainly says) | Repo comment rule; ponytail (prose = smuggled complexity) | Comment only genuinely non-obvious things; delete the rest. |
| **Encoding outcomes as extra states** (`no_recipe` + `failed` statuses) | Type-driven: model the domain, don't sprawl states | One `failed` state + an `error_code` the client branches on. |
| **Denormalizing a shared entity to one owner** (`recipes.user_id`) | Model the domain | Canonical `recipes` + a `saved_recipes` join (many users, one recipe). |
| **Config/params for a value that never varies** (`ensureDatabases(names = …)` only ever called with the default) | YAGNI; no unrequested flexibility | Inline the constant; add the param when a second caller needs it. |
| **DI container / composition root** (`buildContainer`, `Container`, threading `db` through params) | Over-abstraction; not our style | **Singletons** — create `db` once, export it, import it directly. No container, no DI. |
| **Free functions where a class fits** | Weaker cohesion/design | **Classes** with a **`static create()`** factory wiring singletons. Less functions, more classes. |
| **Casting DB rows to the domain** (`$inferSelect` straight out of the repo) | Type-driven: validate where DB meets domain | **Zod domain models** — repositories `parse` rows into a `Zod` schema at the boundary. |
| **Workflow that does the work** (the DBOS workflow fetching/parsing itself) | SRP; workflow ≠ business logic | Workflow = status + exception handling only; the work is a separate, decomposed concern. |
| **Monolithic multi-network-call step** (`parse-provider.run()` = fetch+ASR+vision+extract+persist in one step) | SRP; wastes DBOS memoization | One `step` per network call, so a late failure re-runs only the failed stage, not all of them. |
| **Un-mockable workflow deps** (module-scoped `ImportJobRepository.create()` inside the workflow file) | Testability; the workflow test can't substitute it | Put status writes / work behind mockable step modules; unit-test the workflow by mocking steps. |
| **Testing a dependency's own guarantees** (a crash-resume test proving DBOS recovers workers) | YAGNI on tests; not our code | Trust the vendor's tests. Delete it. |
| **A "source" grab-bag** (`ResolvedSource {platform, sourceType, normalizedUrl, imageRef}`; a service method untangling `{url?, sharePayload?, imageRef?}`) | Model the domain; SRP | `source` = a clean enum (the platform); the URL/ref is a *separate* value. Classifier returns the enum; the route normalizes input before the service. |
| **Routes in their own file when the app has an inline convention** (`import-routes.ts` while auth routes live in `app.ts`) | Consistency | Follow the established pattern — register routes where the others are. |

## Distilled checklist (apply before committing)

- Did I add anything nothing yet uses? → cut it, or move it to the ticket that uses it.
- Am I guarding a failure a test/pre-launch check already catches? → delete the guard.
- Is there a plain stdlib/tool/native way? → take it over the clever one.
- Is any comment longer than the code it explains? → trim to the non-obvious.
- Does the type/schema make bad states unrepresentable, or am I validating them by hand?
- Is this the shortest diff that works, *given I actually understand the change*?

## Log

| Date | Ticket | Feedback | Resolution |
|---|---|---|---|
| 2026-08-02 | WI-01 | PR #1 review: Neon WebSocket driver, ping-workflow/DBOS-too-early, boot migrations + custom migrate script, trivial tests, verbose comments, `no_recipe`/`failed` split, `recipes.user_id`, `icon_key`, unused param | Simplified to plain `pg`; `drizzle-kit migrate`; deleted trivial tests; trimmed comments; `failed` + `error_code`; `saved_recipes` join; `recipe_steps`; dropped `icon_key`. |
| 2026-08-02 | WI-01 | Follow-up: DBOS pulled into the scaffold before use; DI container; free functions over classes; no Zod domain models | **Removed DBOS from WI-01** (→ WI-03, where the first workflow uses it). **Deleted the container** → `db` singleton. Established: classes + `static create()`, Zod domain models parsed at the repo boundary — in `server/CLAUDE.md`. |
| 2026-08-03 | WI-02 | PR #3 review: verify + create in one endpoint; inline input object; `decodeSub`/`verify` juggled in the guard | Split `POST /v1/otps/verify` from `POST /v1/users` (create trusts the verified phone, per phonetastic); `CreateUserRequest`/`SignInRequest`/`Resolution` types at file top; consolidated token→user resolution into one `UserService.userForToken` the guard + refresh share. |
| 2026-08-03 | WI-03 | PR #4 review: routes in own file; functional DBOS + free-function parse seam; "source" grab-bag + `ImportService.create` doing too much; crash/DBOS-harness tests | Routes → `app.ts`; DBOS **class** workflow, thin (status + exceptions only); import work decomposed into memoized **steps** (separate concern); `detectSource(url)→SourceType` classifier + `createFromUrl`/`createFromPhoto`; deleted the DBOS-recovery tests; workflow unit-tested by mocking steps. See "durable-pipeline architecture" above. |
