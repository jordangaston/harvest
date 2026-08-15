# Wave 2 — implementation brief

Your design is **approved**. Build it. Run the full `/autonomous-sprint` **from Phase 4** (Phases 2/3 —
clarify + design — are done; your `docs/sprint-<task>/DESIGN.md` is the approved design, `WAVE2-DECISIONS.md`
the founder's decisions). Your worktree is rebased onto the merged `main` (Cleanup + client-cache infra).

## Phases 4 → 8 (never stopping; decide-and-log to POSTMORTEM.md)
- **Phase 4 — per-sub-story work-item specs** under `docs/sprint-<task>/specs/` (via `Skill(work-item-spec)`),
  decomposing your design into testable units, each mapping acceptance criteria → test cases + the files it touches.
- **Phase 5 — pre-mortem** (a subagent: "assume this failed — why?") against the specs + real code; fold findings.
- **Phase 6 — implement** to the specs + design. Follow every binding doc (`AGENTS.md` design system: no
  `bg-white`, sheets `bg-cream`/rows `bg-card`, Lora/Karla, **motion tokens + Reduce Motion on every animated
  surface**; `server/CLAUDE.md`: Drizzle migrations-only, classes + `static create()`, Zod-at-boundary, one
  chokepoint, **tests never hit the network**).
- **Phase 7 — demo EACH sub-story** on the booted iOS sim (UI) / via a live exercise (backend); evidence in
  `docs/sprint-<task>/demos/`.
- **Phase 8 — SPRINT-REPORT.md**. Keep POSTMORTEM.md open from the start.

## Client caching is now REQUIRED (PR #17 merged)
The app has **TanStack Query + AsyncStorage** persistence. **Read `docs/client-caching.md`.** Wrap your data
reads in `useQuery` using the `lib/queryKeys.ts` factory (add keys for your resources), reuse the
`lib/api/hooks.ts` pattern, and **invalidate the right keys on your mutations** (e.g. add a meal-plan entry →
invalidate the meal-plan-week key). Do NOT hand-roll fetching or bespoke caches. Cached data must not refetch
until a mutation changes it.

## Cross-task seam decisions (respect these — coordinator-owned)
1. **Common ingredients = an ENDPOINT, not a file.** Grocery ships `GET /v1/ingredients/common`
   (`[{canonicalName, aisle, defaultUnit, iconKey}]`); Meal Planning **consumes that endpoint** (a small
   hard-coded fallback list only until it lands). Nobody reads `server/seed/grocery-catalog.json` from mobile.
2. **`users.name` is owned by Phone Auth** — Phone Auth adds the column, writes it at signup, AND surfaces it in
   `UserSchema` + `GET /v1/users/me`. Profile + Instrumentation **only read** it (null-tolerant until Phone Auth merges).
3. **Migrations** — `main` is at 0008; generate your migration normally (you'll get `0009`). Numbers WILL collide
   across branches — the **coordinator renumbers/reconciles at integration** (merge order phone-auth → meal-planning
   → grocery). Keep each migration self-contained; state in your report which tables/enums it adds.
4. **`deleteAccount`** (Profile) must delete every user-owned child table; the coordinator schedules the
   post-merge test that seeds + asserts `meal_plan_entries` + `grocery_items`.

## Parallel-safety: isolate your test DB (six sprints share one Postgres)
All six worktrees point at the **same** local Postgres (`vitest.config.ts` hardcodes DB `harvest` +
`harvest_dbos`), and `global-setup` **resets the schema** — so concurrent test runs collide. Before running
tests, point your suite at a **worktree-unique** DB (`harvest_test_<task>` / `harvest_dbos_<task>`): set it in
`server/vitest.config.ts` `test.env` **and** confirm `global-setup` uses it (it reads `process.env.DATABASE_URL`
— export it too if needed). `global-setup` auto-creates + migrates the DB. Verify your suite is green in
isolation, then **REVERT that config edit before committing** — the PR diff must keep the default `harvest`
(this is a local parallelism workaround, not a product change). Log it in POSTMORTEM.

## DONE — all four, then `worker_done`
1. Whole server suite green (offline) + mobile typecheck clean.
2. Each sub-story demoed (evidence in `demos/`).
3. PR opened against `main` from your branch.
4. `SPRINT-REPORT.md` + `POSTMORTEM.md` written.

Report `worker_done` with the PR link, test summary, per-story demo evidence, and doc paths. `orca orchestration
ask` the coordinator only for a genuine founder-level blocker (e.g. an external credential you can't stub).
Add any feature-agnostic lesson to `docs/harvest-principles.md`.
