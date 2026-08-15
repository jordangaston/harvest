# Instrumentation — POSTMORTEM (kept open from Phase 4)

Decision-and-log of blockers, deviations, and lessons. Written as they happen.

## Environment / parallelism
- **Worktree not installed on dispatch** — `npm i` (root + `server/`) was the first step. Logged; expected.
- **Test-DB isolation:** server suite is run against a worktree-unique DB, config reverted before commit
  (see "Test isolation" below). This task adds **no server code**, so the suite is a regression gate only.
- **Shared simulator:** the iOS sim is shared across six sprints. Per the coordinator addendum, Phase-7 sim
  work uses a dedicated device + a unique Metro port; sessions kept short. See "Demo strategy."

## Decisions & deviations
- **D-A — SDK is a native module I cannot prebuild here; the only runnable path is Noop.** The token is unset
  in dev/sim/tests (decision #5), so `MixpanelBackend` never loads. I wired it via a **dynamic `require`** so
  Metro doesn't statically pull an uninstalled native module into the dev bundle, and I did **not** add
  `mixpanel-react-native` to `package.json`/lockfile (keeps the PR clean; enabling it is a founder step in the
  one-pager). The live-send path is therefore verified by construction + typecheck, not executed. Upgrade path:
  founder runs `npx expo install mixpanel-react-native`, sets the token, and builds. Ceiling documented.
- **D-B — No mobile test runner exists** (package.json had only `typecheck`). Rather than scaffold jest-expo,
  I kept all non-trivial logic in RN/expo-free units (`people`, `label`, `backend`, `core`) and cover them
  with `node --test` (Node 24 strips TS). This is the offline "live exercise" for the logic sub-stories.
- **D-C — No client-cache hooks needed.** Instrumentation adds no data reads/writes, so `docs/client-caching.md`
  imposes nothing; I add no `queryKeys`/`useQuery`. Noted so a reviewer doesn't expect cache wiring.

## Test isolation (reverted before commit)
- **Configured Postgres (5432) was down on dispatch; the disk was also 100% full.** Two infra blockers hit
  mid-implement (see D-D, D-E). Once 5432 came up (PG 17.6, `postgres:postgres`), I ran the server suite
  against **isolated DBs** `harvest_test_instrumentation` / `harvest_dbos_instrumentation` on 5432 (pre-created
  by hand, since `scripts/create-databases.ts` only auto-creates the hardcoded `harvest`/`harvest_dbos`).
  Result: **86 tests / 23 files green, offline.** Then I **reverted `server/vitest.config.ts` to the default
  `harvest`/`harvest_dbos`** — `git diff server/vitest.config.ts` is empty in the PR.
- **`global-setup` isolation caveat (worth a principle):** the env override only isolates the *reset+migrate*
  target, not DB *creation* — `ensureDatabases` uses a hardcoded list, so a worktree-unique DB must be
  pre-created (`CREATE DATABASE …`) before the suite runs. The brief's "global-setup auto-creates it" only
  holds for the default names.

## Demo strategy
- Instrumentation has no UI/endpoints, so the "live exercise" is `demos/journey-trace.ts` — the real
  `Analytics` core driven through a full user journey — plus the 13-test offline suite. Evidence in
  `demos/DEMO.md`. The live Mixpanel send path is token-gated/dormant, so there is nothing to screenshot on
  the sim (documented, not skipped).
- **Dedicated sim not needed:** because the runnable path is Noop and the demo is an offline core exercise, I
  did not boot a per-task simulator or run Metro. Logged per the coordinator's sim-isolation addendum — had a
  UI been involved I would have used a dedicated device + unique Metro port.

## Decisions & deviations (continued)
- **D-D — Disk full (ENOSPC) mid-implement.** Write/Edit and all Bash briefly failed (the shared Data volume
  hit 100%; even tool output files couldn't be written). Escalated to the coordinator, purged the 3.2G npm
  cache, and space recovered enough to continue. Root cause: six worktrees × two `node_modules` each.
- **D-E — Postgres 5432 down, needed to reach a running instance.** `pg_isready` failed; brew PG was on 5433
  with no `postgres` role. 5432 (EDB PG 17) came up shortly after; I used it with isolated DBs. No product
  impact.

## Lessons (feature-agnostic → candidates for docs/harvest-principles.md)
- **Test-DB isolation must pre-create the DB, not just point at it.** Env-var overrides don't isolate DB
  *creation* when a setup script hardcodes the database list; a shared-Postgres worktree must
  `CREATE DATABASE <unique>` first. (Added to principles.)
- **Instrument at the shared primitive, not per screen.** Wrapping `Button`, `OnboardingScreen.onCta`, and the
  `apiFetch`-adjacent `lib/api/*` functions covers the app from ~7 edits and never touches a sibling's screen —
  the single-chokepoint invariant applied to analytics.
