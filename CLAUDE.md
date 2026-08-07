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

Sprint records (context on how the import feature was built and fixed): `docs/sprint-import/`,
`docs/sprint-import-fixes/`, `docs/sprint-import-fixes-2/` — each has a `POSTMORTEM.md` + `SPRINT-REPORT.md`.

When you discover another feature-agnostic lesson worth keeping, add it to `docs/harvest-principles.md`
(or `docs/rn-nativewind-pitfalls.md` for RN specifics) and link it here.
