# Postmortem — full serverless re-architecture on Cloudflare (v2)

What was harder than expected, and the lessons worth keeping. (This replaces the v1 postmortem; the
v1 spike answered the wrong question.)

## What went well

- **Answering with a runnable, self-asserting proof.** `proof.sh` does not just print output — it
  asserts the recovery claim (step-execution counts + exactly-one-recipe), so "the Workflow resumed"
  is a green check, not a story. Anyone can reproduce it offline in under a minute.
- **Reading the versioned docs before coding.** Confirmed `step.do` retry config, D1's `batch`
  semantics, and Drizzle-D1 against `developers.cloudflare.com`, so the design rested on the shipped
  API, not memory. This caught the transaction limitation before a line was written.
- **Isolation held.** All new code lives in `server/spike-cf/` with its own package and vitest config;
  production `src/` diff is empty and its suite stayed 91/91 green.

## What bit us

### 1. D1 has no interactive transaction — the persist had to be redesigned, not ported

`RecipeRepository.persist` wraps recipe + ingredients + steps in `db.transaction()`. D1 does not
support interactive transactions; its atomic unit is `db.batch([...])`. The port is not mechanical:
because SQLite has no `RETURNING`-into-a-transaction flow, the recipe id must be generated in app code
**before** the batch so later statements can reference it. **Lesson:** the Drizzle *queries* port to
D1, but any multi-row write that depended on a Postgres transaction is a redesign — surface it in the
migration map, don't discover it at cutover.

### 2. A Node-only reflex (`require`) doesn't run on Workers

First cut of `db.ts` reached for `const { sql } = require('drizzle-orm')` inside a helper. Workers is
ESM-only — no `require`. Trivial to fix (a top-level import), but it is the migration-in-miniature:
**the risk isn't the big dependencies, it's the small Node-isms** (`require`, `node:fs`, `Buffer`
assumptions) scattered through otherwise-portable code. The Node-only-API table in `RECOMMENDATION.md`
exists because of exactly this class of thing.

### 3. Tooling assumed the parent project's config

`wrangler@4.123` needs `@cloudflare/workers-types@5` (a peer-dep conflict against the v4 I pinned),
and vitest walked up to `server/vitest.config.ts` and tried to run the Postgres global-setup. Both
cost a cycle. **Lesson:** a "parallel prototype" only stays parallel if it carries its own
`package.json`, `vitest.config.ts`, and `tsconfig.json`; inheriting the parent's is a leak.

### 4. Local `wrangler dev` can't force an eviction

The bar asked for "step fails / instance evicted → resumes." Local emulation won't evict an isolate on
command. Rather than fake it, the proof throws inside a step: the engine re-enters `run()` and replays
completed steps from durable storage — the **identical** path an eviction triggers. **Lesson:** when
you can't reproduce the exact failure, reproduce the exact recovery *mechanism* and say so plainly,
rather than staging something that only looks like the real thing.

## Distilled principles (candidates for `docs/harvest-principles.md`)

- **Cloudflare Workflows preserves durable-execution semantics without a long-lived process.** A
  failed step retries in place; completed steps return checkpointed results without re-running. It is
  a genuine DBOS replacement for this pipeline.
- **Porting to a new runtime, the queries move but the write *patterns* may not.** Postgres
  transactions → D1 `batch` + app-generated ids is a design change, not a find-and-replace.
- **On a runtime migration, hunt the small Node-isms, not just the big deps.** `require`, `node:fs`,
  `child_process`, `Buffer` — the portable-looking code hides them.
- **A parallel prototype owns its whole toolchain.** Separate package, test, and TS config, or the
  parent's setup leaks in.
- **When you can't reproduce the failure, reproduce the recovery mechanism — and say which you did.**
