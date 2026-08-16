# Profile sprint — POSTMORTEM (kept open from Phase 4)

Running log of decisions, blockers, and corner-cuts. Folded into SPRINT-REPORT at the end.

## Decide-and-log

- **Test-DB isolation (parallel-safety workaround).** Six sprints share one Postgres. Created
  worktree-unique DBs `harvest_profile` + `harvest_dbos_profile` (`ensureDatabases` only auto-creates the
  two hardcoded names, so created them manually via `psql CREATE DATABASE`). Point the suite at them by
  editing `server/vitest.config.ts` `test.env` **and** exporting `DATABASE_URL`/`DBOS_SYSTEM_DATABASE_URL`
  in the shell (global-setup reads `process.env`). **MUST revert the vitest.config edit before commit** — the
  PR keeps default `harvest`.
- **Sim isolation (Phase 7).** The iOS simulator is shared across all six sprints. Booting a dedicated
  device `Harvest-profile`, targeting it via `IDB_UDID`, Metro on a unique port. Keeping sessions short.
- **Default avatar art.** Generated a painterly golden-hour faceless-bust avatar on `#F1E6D2` cream via the
  nano-banana-2 MCP; downscaled to 256px (`assets/default-avatar.png`, ~94KB). Blends onto `bg-cream` since
  the generated background is the canvas tone.
- **Defensive deletion of sibling tables.** `meal_plan_entries` + `grocery_items` are not on this branch.
  `deleteAccount` deletes them via `to_regclass`-guarded raw SQL (no-op when the table is absent), so it is
  correct now and stays correct after Meal Planning / Grocery List merge. Deletes them **before** `recipes`
  (they carry `recipe_id` FKs). Covered by a self-contained integration test that creates throwaway
  `meal_plan_entries`/`grocery_items(user_id)` tables, seeds a row, and asserts the guarded delete empties them.
- **`name` from `/me`, null-tolerant.** Phone Auth owns `users.name` + surfacing it in `/me`. Profile reads
  `user.name` as optional and renders a generic greeting until it merges. Profile does NOT touch `getMe`.

## Blockers (resolved without founder escalation)
- **Postgres on 5433, not 5432.** Every worktree's `.env` and `vitest.config` default to `localhost:5432`,
  but the only running Postgres (homebrew `postgresql@14`) listens on **5433**, and nothing is on 5432. The
  grocery sprint's DBs (`harvest_test_grocery`) confirmed the cohort overrides to 5433. Worked around by
  pointing my run at 5433 (`.env` — gitignored; `vitest.config` `test.env`; and the hardcoded
  `LOCAL_ADMIN_URL` in `scripts/create-databases.ts`). **All three reverted before commit.** Flag for the
  coordinator: the committed default (5432) will not run locally until PG is on 5432 (or the repo default
  moves to 5433).
- **`ENOSPC` mid-run.** The shared disk hit 0 bytes free (six worktrees installing in parallel). Cleared
  `~/.npm/_cacache` and my scratch video frames; space recovered as sibling installs finished.
- **Base lockfile out of sync.** `npm ci` failed — `package-lock.json` is missing `react-dom@19.2.8`
  /`scheduler` (a client-cache-merge artifact, not mine). Used `npm install` to sync + install locally;
  **reverted `package-lock.json` before commit** so the PR stays focused. Flag: the base lockfile needs a
  regen on `main`.
- **Env vars don't persist across shell calls.** Each Bash call is a fresh shell, so `export`ed
  `DATABASE_URL` was lost by the next call — `global-setup` (main process) fell back to the wrong DB. Fix:
  inline the env on the same line as `vitest`/the server.

## Sim isolation (Phase 7)
- Booted a dedicated device `Harvest-profile` (own UDID), ran the server on **3005** and Metro on **8087**
  (both unique), and drove only my device. Expo CLI's `--ios` ignores `IDB_UDID` and installed Expo Go on
  another sprint's sim (`Harvest-phoneauth`); recovered by copying that Expo Go bundle onto my device with
  `simctl install`, then `openurl exp://127.0.0.1:8087`. reanimated-4 rules out Expo Go on paper, but SDK 54
  Expo Go bundles it, so the app ran without a native dev build.

## Corner-cuts / known ceilings
- **Delete/logout teardown race (closed in practice, tiny theoretical window).** After a 204, `apiFetch`'s
  401→provision path could re-provision a new user if a protected query refetched. Mitigated by navigating to
  welcome **first** (unmounts the protected screens), then `clearSession()` + `queryClient.clear()`. Verified
  live: the server log shows the DELETE with **no** subsequent `POST /v1/users`. Ceiling: a hostile refetch
  scheduled in the same tick could still slip through; a module-level "signed-out" latch in `apiFetch` would
  close it fully, but that is cross-cutting and unneeded for v1.
- **`meal_plan_entries` / `grocery_items` deletes are guarded, not yet exercised on real tables.** They no-op
  until those branches merge; the integration test stands up throwaway tables to prove the guarded delete
  fires. The coordinator's post-merge seeded test is the real backstop.
