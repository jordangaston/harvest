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

## Standing practices (read + apply on every task)

1. **`/quality-software-manifesto`** — read before writing or designing. The load-bearing bits here:
   *Keep things small* (writing small takes more effort; delete aggressively — small programs change
   faster), *Expect failure* (use fault-tree analysis to find and **prioritize** failure modes — not to
   guard all of them), *Prefer type-driven design* (let the schema/compiler exclude bad states, e.g.
   model the domain right instead of enumerating edge validations).
2. **`/ponytail:ponytail`** — the lazy-senior ladder, run *after* understanding the problem: does this
   need to exist at all (YAGNI) → is it already in the codebase → stdlib → native/platform → an
   installed dep → one line → only then, minimum code. Deletion over addition. Shortest working diff.

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
| 2026-08-02 | WI-01 | PR #1 review: Neon WebSocket driver, ping-workflow/DBOS-too-early, boot migrations + custom migrate script, trivial tests, verbose comments, `no_recipe`/`failed` split, `recipes.user_id`, `icon_key`, unused param | Simplified to plain `pg`; `drizzle-kit migrate`; deleted trivial tests; trimmed comments; `failed` + `error_code`; `saved_recipes` join; `recipe_steps`; dropped `icon_key`; (pending) move DBOS bootstrap out of the scaffold into WI-03. |
