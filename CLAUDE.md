@AGENTS.md

# Reference docs — read these before designing/building

High-value, evergreen docs. Check the relevant one before starting related work.

- **`AGENTS.md`** — Harvest design system: golden-hour tokens, the white/`bg-cream`-modal rule,
  typography, and **Motion** conventions. (Imported above; the source of truth for UI.)
- **`docs/harvest-principles.md`** — evergreen engineering & design principles distilled from the
  sprints (verify-against-live-reality, single-chokepoint invariants, tiered fallback, reused-instance
  state resets, and more), each with evidence and where it lives.
- **`docs/rn-nativewind-pitfalls.md`** — React Native / NativeWind / Expo gotchas that each cost a
  debug cycle (JS-driver-on-mount, explicit colour in `Animated.View`, `Modal` over hand-rolled sheets,
  reset reused instances, read-once module signals, "installed ≠ wired").
- **`server/CLAUDE.md`** — backend conventions (DBOS pipelines, Drizzle, Zod domain models, testing).
- **`lib/motion.ts`** — the canonical RN motion-token scale (durations, easing, toast timing).
- **`docs/orchestration-runbook.md`** — running this repo's multi-agent sprints with the Orca CLI: dispatching
  Feature Leads to isolated worktrees and the `worker-start`/terminal gotchas. (See "Multi-agent sprint workflow" below.)

Sprint records (context on how the import feature was built and fixed): `docs/sprint-import/`,
`docs/sprint-import-fixes/`, `docs/sprint-import-fixes-2/` — each has a `POSTMORTEM.md` + `SPRINT-REPORT.md`.

When you discover another feature-agnostic lesson worth keeping, add it to `docs/harvest-principles.md`
(or `docs/rn-nativewind-pitfalls.md` for RN specifics) and link it here.

# Multi-agent sprint workflow

The remaining v1 features ship as a program of autonomous sprints: a **coordinator** orchestrates, one
**Feature Lead** owns each task end-to-end, and an **Architect** reviews design before it reaches the founder.
These rules were learned the hard way — see `docs/sprint-cleanup/POSTMORTEM.md`.

- **Pull `main` before every cycle.** After a task's PR merges, every worktree that builds on it rebases/pulls
  `main` before starting or continuing. Dependent waves branch from the merged `main`, not a stale base.
- **Roles & isolation.** The coordinator orchestrates and never implements a task itself. Each task runs as an
  **independent agent in its own worktree** — never an in-session subagent sharing another tree — so parallel
  Leads never collide. The Architect's written review lands before the founder sees a design.
- **Each Lead runs the full `/autonomous-sprint`** (Phase 0/1 → per-story specs → pre-mortem → implement →
  demo-each → report), not a "here's the design, go build it" shortcut. The coordinator's CLARIFY and DESIGN
  gates *are* the sprint's Phase 2 (clarify) and Phase 3 (design review), so Leads start at Phase 0/4 and run
  4→8 without re-pausing the founder.
- **A "done" claim is not done.** Before the review gate, the coordinator independently verifies — re-run the
  whole test suite from clean, confirm the PR exists against `main`, open the demos — and relays only verified
  results.

Dispatching Leads with the Orca CLI has sharp edges (unsubmitted prompts, worktree-mismatch, stale terminal
reads) — see **`docs/orchestration-runbook.md`**.
