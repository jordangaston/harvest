# Cleanup — Autonomous Sprint Brief (supersedes IMPLEMENT-BRIEF.md)

**Run your work as a `/autonomous-sprint`.** Invoke `Skill(autonomous-sprint)` and follow its phases exactly.
The worktree was reset to clean (an earlier attempt jumped straight to coding with no specs/pre-mortem and was
discarded) — start fresh and do this by the book. Work only in this worktree.

## What's already done (do NOT redo or re-pause the human)
The program-level gates already satisfied the sprint's two human-pause phases:
- **Phase 2 (clarify):** the founder answered every clarifying question. Do not re-ask.
- **Phase 3 (design review):** the design is written, Architect-reviewed, and **founder-approved**. It is your
  Phase-3 artifact: `docs/sprint-cleanup/DESIGN.md` (Revision 2) + `ARCHITECT-REVIEW.md`. Treat DESIGN.md as
  the source of truth; don't relitigate settled decisions.

So you **start at Phase 0/1, then run Phases 4 → 8 without stopping.** After this point there is **no human
pause** — decide-and-log every blocker to POSTMORTEM.md and continue. **Never use `AskUserQuestion`** (it hangs
in this harness). Only `orca orchestration ask` the coordinator, and only for a genuinely founder-level blocker
(should be rare).

## Phase 0 — orient & verify (open the post-mortem NOW)
- Open `docs/sprint-cleanup/POSTMORTEM.md` immediately and log decisions/blockers **as they happen** all sprint.
- Read the binding conventions and follow them to the letter: `CLAUDE.md`, `AGENTS.md`,
  `docs/harvest-principles.md`, `server/CLAUDE.md`, `lib/motion.ts`, `docs/rn-nativewind-pitfalls.md`.
- Make the env runnable: install deps (root app + `server/`); confirm the server test harness runs
  (`vitest` against local Postgres via `tests/helpers/global-setup.ts`) and the Expo app can launch on the
  **booted iOS simulator**. Verify against the real thing, not a stale copy.

## Phase 1 — reference analysis (light)
Cleanup's references are the heb-bot ingredient/measurement model (`~/workspace/heb-bot`) and USDA FDC — both
already analyzed in DESIGN.md. Write a short `docs/sprint-cleanup/00-reference-analysis.md` capturing what you
took from each (or a one-line note that DESIGN.md already carries it).

## Phase 4 — one work-item spec per sub-story
Using `Skill(work-item-spec)` (or its format), write a detailed, testable spec per sub-story under
`docs/sprint-cleanup/specs/`: `spec-01-c1-hide-discover.md`, `spec-02-c2-onboarding-enums.md`,
`spec-03-c3-structured-ingredients.md`, `spec-04-c4-servings.md`, `spec-05-c5-nutrition.md`,
`spec-06-c5a-food-catalog.md`, `spec-07-c6-ownership.md`. Each maps acceptance criteria → concrete test cases
and names the exact files/functions it touches, grounded in DESIGN.md + ARCHITECT-REVIEW.md. The C5a spec must
include the **Matching** design (founder-approved lexical + alias table + Sørensen–Dice on char bigrams ≥ 0.8,
NOT embeddings): normalization stop-list → exact canonical/alias → head-noun/token-subset → bounded Dice → null
+ log; with the guardrail tests (alias `eggplant`, plural `tomatoes`, head-noun `extra virgin olive oil`,
near-miss → null, and **`"cream"` must NOT match `"ice cream"`**).

## Phase 5 — pre-mortem, then fold
Spawn a subagent: "assume this Cleanup sprint failed — find why, concretely, before we build." Point it at the
specs **and** the real code (the C3 type-change ripple, the ownership touch-points, the matcher accuracy, the
migration ordering, offline-test guarantees). Demand a prioritized blocker list, each with a one-line fix/safe
default. Fold findings into the specs + POSTMORTEM. Don't halt for anything — decide, log, move on.

## Phase 6 — implement in dependency order, never stopping
Build to the specs + DESIGN.md. Migrations **0006 (C6), 0007 (C2 enums), 0008 (C4+C5)** via `drizzle-kit
generate` → `migrate`; no 0009 (food catalog is the in-memory `FoodCatalog` from committed `server/seed/
foods.json`). Follow every binding convention (no `bg-white`; motion tokens; classes + `static create()`;
Zod-at-boundary; one chokepoint at the `toExtractedData` adapter + `toRecipeInput`; tests never hit the
network). Test the risk-bearing logic; a test you write isn't done until it AND the whole suite pass. Prefer the
smallest change that works and reuse existing patterns.

## Phase 7 — demo EACH story
Prove each sub-story in the real runtime, driving it yourself, and capture evidence per story under
`docs/sprint-cleanup/demos/`:
- **UI stories** (C1 hide Discover, C2 onboarding capture/POST) — on the **booted iOS simulator**; record
  video / native-res frames per the transient-UI convention.
- **Backend stories** (C3 structured ingredients, C4 servings, C5 nutrition, C5a catalog, C6 ownership) —
  exercise the real behavior: import a real recipe and show persisted `amount/unit/quantity_text`, an
  estimated `servings`, and `computed`/`parsed` nutrition; show owner-edit-in-place vs non-owner → 404. A
  focused live run + captured output is a valid demo.

## Phase 8 — sprint report
Write `docs/sprint-cleanup/SPRINT-REPORT.md`: a story → status → proof table (linking each demo), what went
well, what to improve, follow-ups. Clear and concise. Add any feature-agnostic lesson to
`docs/harvest-principles.md` (or `docs/rn-nativewind-pitfalls.md`).

## DONE — all four before `worker_done`
1. All tests pass (unit + integration; whole suite green).
2. Each story demoed (evidence in `demos/`).
3. PR opened against `main` from `jordangaston/cleanup-sprint`.
4. `SPRINT-REPORT.md` + `POSTMORTEM.md` complete.

Report `worker_done` only when all four hold — with the PR link, the test summary, per-story demo evidence, and
the report/postmortem paths. If genuinely blocked, `escalation` (pre-completion) with specifics. Do not fail or
abort over a blocker — decide, log, continue.
