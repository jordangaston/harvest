# Grocery Lists — Sprint POSTMORTEM

Kept open from the start; each blocker was decided-and-logged so the sprint never stalled.

## Environment failures (the big ones)

### 1. Machine-wide disk exhaustion (ENOSPC) mid-run
Partway through, the shared APFS container feeding all six parallel sprints hit **0 bytes free**. Even tool
output couldn't be written. Root cause: the nano-banana MCP saves each image to `generated_imgs/` **and** we
copied it into `assets/ingredients/` — double the footprint — on an already-tight shared disk.
- **Impact:** aborted icon generation mid-batch; crashed the shared Postgres; corrupted a root `npm install`;
  and silently failed the `catalog.ts` Write (had to be rewritten).
- **Fix / decision:** deleted `generated_imgs/` (freed several GB), then repeatedly reclaimed it as the run
  progressed. Escalated to the coordinator (non-blocking) since it hit all six sprints.
- **Lesson:** large image-gen batches need a disk budget and **eager cleanup of `generated_imgs/`**; treat the
  MCP's working dir as scratch, not an archive. Verify critical file writes that happened during an ENOSPC window.

### 2. Shared Postgres broken by the disk event
After the crash, `postgresql@14` came back on **port 5433** (not the 5432 every worktree's `vitest.config.ts` +
`create-databases.ts` hardcode) with **no `postgres` role** (only `jordangaston`); nothing on 5432.
- **Fix / decision:** escalated (affects all six sprints). Self-remedied for my own run: created role
  `postgres`/`postgres` + isolated DBs `harvest_test_grocery` / `harvest_dbos_grocery` on 5433, pointed my suite
  there, **reverted the config before commit** (PR keeps default 5432).

### 3. vitest `globalSetup` does not receive `test.env`
Pointing `vitest.config.ts` `test.env` at the isolated DB migrated the **wrong** DB — `globalSetup` runs in the
main process and doesn't see `test.env`. **Fix:** export `DATABASE_URL` + `DBOS_SYSTEM_DATABASE_URL` +
`PG_ADMIN_URL` as real process env on the command line so both the workers and `globalSetup` agree.
(Made `global-setup` honor `PG_ADMIN_URL`, then reverted it too.)

### 4. Root (mobile) `node_modules` was empty
The worktree's mobile deps were never installed (or wiped in the disk event), so typecheck and the sim couldn't
run. **Fix:** `npm install --legacy-peer-deps` (Expo peer conflicts need the flag); `node_modules` is gitignored,
so no PR impact.

## Process failures

### 5. The icon-gen subagent didn't honor the stop promptly
Delegated ~100 icon generations to a background subagent to keep its tool output out of context. When the disk
filled I sent a stop; it had reached 17 and I reconciled + capped at 17. It then **resumed** and generated ~98
total, rewriting `icons.ts` but (transiently) not `components/recime/recipes.ts`, leaving the two icon maps
inconsistent (keyword targets without ICON entries) until it finished. Net outcome is **positive** — the founder's
~100 target was effectively met (153 total assets) — but the mid-run inconsistency was risky.
- **Lesson:** a long autonomous image-gen subagent needs a **hard cap + checkpoint manifest**, not a mid-run stop
  message. Reconcile the two maps from ground truth (the asset files) rather than trusting either map. It also
  recreated a mobile-side `__tests__` file twice after deletion — verify a stopped agent has actually stopped
  before committing.

### 6. No mobile test runner
The repo has no root vitest/jest. The pure grocery utils (`parseGroceryLine`, `scaleAmount`, `groupAndSort`) are
covered by `tsc` + the live demo, not unit tests; a cross-boundary server test failed because the root Expo
`tsconfig` (`extends "expo/tsconfig.base"`) can't resolve from the server context. The **icon-lockstep test lives
in the server suite** and reads the mobile files via `fs` — the one place that runs in CI.

## Sim isolation (addendum)
The iOS simulator is shared across six sprints. Per the addendum, Phase-7 demos used a **dedicated device**
(`Harvest-grocery`) via `xcrun simctl` with `IDB_UDID` exported and Metro on a unique port. (See SPRINT-REPORT for
the demo outcome and any resource-constraint fallback.)

## What went well
- Server built to the design cleanly; **102/102 server tests green offline**, incl. the merge chokepoint, the
  API, and the icon-map lockstep.
- The `resolve(name)`-via-icon-taxonomy design meant the ~98 new icons + catalog rebuild "just worked" — coverage
  jumped from 59→114 of 160 catalog entries with real icons, no code change.
