# Harvest — Evergreen Engineering & Design Principles

Feature-agnostic principles distilled from `docs/sprint-import-fixes-2/POSTMORTEM.md` and the
three-sprint engineering history. Each one is reusable across **all** future work — not a bug log.
Every principle is traceable to a concrete moment; the evidence is cited.

---

## Verification & truth-seeking

### Verify against live reality, not the report, the doc, or your own assumption
- **Rule:** Before you build against a behavior, reproduce it against the running thing with the real inputs. Treat bug reports, specs, and prior notes as hypotheses, not facts.
- **Why (evidence):** Post-mortem "Live evidence": Story 3's reported bug ("Instagram carousels have no steps") **did not reproduce** on the live link — the live import returned "5 recipes ALL WITH steps (8,6,6,8,8)." Story 1's leak turned out to be JSON-LD `recipeIngredient` headers, not the LLM as first hypothesized — only confirmed by importing `smokinandgrillinwitab.com` and reading the raw JSON-LD. The most expensive miss (below) was invisible until run live.
- **How to apply / where it lives:** Testing convention. For any "X is broken" ticket, step 1 is a live repro before a line of code. Add to `CLAUDE.md` / `server/CLAUDE.md` testing notes.

### Make diagnostics mirror production's execution shape — especially concurrency
- **Rule:** A diagnostic that runs the code in a different shape than production (sequential vs. parallel, one item vs. many, warm vs. cold) can hide the exact failure you're chasing. Replicate the real execution shape.
- **Why (evidence):** Post-mortem: "**All-Groq carousel reader dropped 2 of 5 recipes live** (11 parallel calls > ~8k TPM; my earlier diagnostic ran slides SEQUENTIALLY so it never rate-limited)." The sequential diagnostic "proved" all-Groq worked; the parallel production path dropped recipes under the token-per-minute cap. Only re-running live surfaced it.
- **How to apply / where it lives:** Guidance. When a diagnostic and production disagree, suspect the harness shape first (parallelism, batching, rate limits).

### Verify transient / animated UI with continuous capture + native-resolution frames
- **Rule:** You cannot verify a sub-3-second or animated UI state with discrete screenshots — the latency window loses it. Record video, extract frames at native resolution, and crop the region.
- **Why (evidence):** This session: the 2.6 s "Saved" toast was un-catchable with screenshots across many attempts; recording + native-res frame extraction revealed first that the toast was **entirely invisible** (native-driver mount stall), then that its **text was missing** (dark-on-dark) — a downscaled frame had hidden the thin cream text.
- **How to apply / where it lives:** Verification convention. For toasts, transitions, and mount animations: `record_video` → `ffmpeg` frames → crop native pixels.

---

## Backend / pipeline architecture

### Fix at the single chokepoint every caller routes through
- **Rule:** When multiple paths produce the same kind of data, apply the cross-cutting rule once at the point they all funnel through — not in each path.
- **Why (evidence):** Post-mortem Story 1: two extraction paths (JSON-LD `website.ts` and the LLM `extractor.ts`) could both leak section-header "ingredients." The fix went in `toRecipeInput` — "the single chokepoint every source routes through before persistence" — not in each extractor. One guard, all sources covered.
- **How to apply / where it lives:** Already a `server/CLAUDE.md` value ("one job per function"); reinforce with "cross-cutting invariants live at the shared boundary, enforced once."

### Robust primary + targeted escalation beats "use the powerful tool everywhere"
- **Rule:** Default to the cheap/reliable path; escalate to the expensive/powerful one only on the specific failure signature. Don't route everything through the premium tool.
- **Why (evidence):** Post-mortem Story 3: the plan was revised from "Groq for every slide" (which hit the ~8k TPM cap and dropped recipes) to "**Tesseract-primary + Groq-escalation on the ingredients-but-no-steps signature**" — escalate only the card that failed. Preserved all 5 recipes; kept cost/latency down.
- **How to apply / where it lives:** `server/CLAUDE.md` pipeline conventions — a stated preference for tiered fallback over blanket use of a rate-limited/expensive provider.

### Data transforms must be safe: never destroy good data to remove bad
- **Rule:** A filter or splitter must be conservative — guard against false positives, and never let it empty a non-empty result. Prefer letting a bad item slip through over dropping a whole record.
- **Why (evidence):** Post-mortem: `stripSectionLabels` "never empties a non-empty list — better a header slips through than a recipe vanishes," and its regex is front-anchored + digit/length-gated so a real step ("To finish, stir in the heavy cream…") survives while the bare header "To Finish" is dropped.
- **How to apply / where it lives:** Guidance for any parser/filter/normalizer: write the safety guard and a keep-case test alongside the drop-case test.

---

### Stage destructive-plus-additive schema changes so codegen stays non-interactive
- **Rule:** When one logical migration both drops a column and adds others on the same table, `drizzle-kit
  generate` can't tell a rename from a drop+add and stops to ask — which hangs in a non-TTY (CI/agent). Split
  the work so each generated migration touches a table with *either* adds *or* drops, not both. Never pipe blind
  keystrokes into the resolver.
- **Why (evidence):** Cleanup C2 moved `users.onboarding` (jsonb) to typed enum columns. Generating the drop +
  the adds together triggered `promptColumnsConflicts` and failed with "Interactive prompts require a TTY."
  Keeping the jsonb through the enum-adds migration (0007) and dropping it in the next, adds-elsewhere migration
  (0008) produced identical end-state DDL with zero prompts — and stayed reviewable.
- **How to apply / where it lives:** `server/CLAUDE.md` Drizzle notes. Order migrations by "adds here / drops
  there"; verify each generated `.sql` by hand before `migrate`.

### Trace a contract change to the live flow, not just the diff — order can defeat correct wiring
- **Rule:** A change that looks correct file-by-file can still be dead on arrival if the runtime *sequence* is
  wrong. After wiring, exercise the actual flow end to end and confirm the data really arrives.
- **Why (evidence):** Cleanup C2's onboarding accumulator + signup POST were wired correctly, but
  `app/_layout.tsx` called `ensureSession()` at startup — provisioning the user *before* onboarding ran, so the
  POST always carried an empty payload. Only walking the real app (sim → DB) surfaced it; the fix moved
  provisioning to the end of onboarding. (Related: a leftover `index.tsx` TEMP redirect skipped onboarding
  entirely.)
- **How to apply / where it lives:** Reinforces "verify against live reality." For any capture→submit flow,
  assert the persisted result after driving the real UI, not just that the pieces exist.

## Design system

### Never ship a pure-white surface — and modals need the canvas tone, not near-white
- **Rule:** No card, sheet, menu, row, chip, or elevated surface uses `bg-white`. Use `bg-card` (#FBF6EC) on the `bg-cream` (#F1E6D2) canvas. **Refinement:** a bottom-sheet/menu/dialog sits on a dark scrim, where near-white `bg-card` reads as white — modal **sheets** should use `bg-cream` (the warm canvas tone) and let their interactive rows be `bg-card` so rows lift off the sheet.
- **Why (evidence):** AGENTS.md already bans `bg-white`, yet the user flagged live: *"the background shouldn't be white. Look at the background color of the save modal."* Pixel-sampling confirmed the sheets were `#FBF6EC` — technically not white, but reading as white on the dim scrim. Fix: all modal sheets → `bg-cream`, rows → `bg-card`.
- **How to apply / where it lives:** **Design-system update.** In `AGENTS.md`'s "white rule" section, add the modal refinement (sheets = `bg-cream`, rows lift with `bg-card`). Consider a repo grep/lint that flags `bg-white` outside the one native-OS-mock exception.

### Motion is a first-class part of the design system
- **Rule:** Every interactive surface animates — no instant pop-ins. Opens are slower than closes; use the smooth-out curve `cubic-bezier(0.22, 1, 0.36, 1)`; always honor OS Reduce Motion; reference the shared motion-token scale instead of hardcoding durations.
- **Why (evidence):** This session's motion pass: four bottom sheets (FAB menu, recipe `⋯` menu, two grocery sheets) were bare conditionals that **popped in**; converting them to `Modal animationType="slide"` made every sheet open/close consistently. The "Saved" toast went from an instant pop to a rise+fade (350 ms in / 250 ms out) with a Reduce-Motion guard. `lib/motion.ts` now holds the canonical `DURATION`/`EASE`/`TOAST` scale.
- **How to apply / where it lives:** **Design-system update.** Add a "Motion" section to `AGENTS.md` (open>close asymmetry, smooth-out default, Reduce-Motion required) and point it at `lib/motion.ts` as the single source of timing.

---

## React Native / NativeWind / Expo pitfalls

### Prefer platform-native primitives over hand-rolled equivalents
- **Rule:** Reach for the built-in RN component before rolling your own. `Modal animationType="slide"` gives a consistent slide + scrim for free; a hand-rolled `{open ? <absolute scrim> : null}` gives an inconsistent instant pop-in.
- **Why (evidence):** The four pop-in sheets above were all hand-rolled conditionals; the fix was simply adopting `Modal`. Native primitives also fixed consistency, not just motion.
- **How to apply / where it lives:** Guidance / RN convention in `AGENTS.md`.

### "Installed" ≠ "wired" — confirm a dependency is functional before relying on it
- **Rule:** A package in `package.json` may not be operational. Verify its build/runtime wiring (babel plugin, provider, native config) before building on it.
- **Why (evidence):** `react-native-reanimated ~4.1.1` was installed but its worklets babel plugin was **not** in `babel.config.js` and it was imported nowhere — so the motion pass used RN's built-in `Animated` instead of risking a broken build.
- **How to apply / where it lives:** Guidance.

### Two concrete `Animated` + NativeWind gotchas to encode
- **Rule:** (1) A native-driver entrance animation on a **freshly-mounted** view silently stalls (opacity stuck at 0) — use the JS driver (`useNativeDriver: false`) for mount-in animations. (2) NativeWind's last-wins color class does **not** resolve inside an `Animated.View`, so a component's default color can win (dark-on-dark) — set the color with an explicit inline `style`, not only a class.
- **Why (evidence):** The toast was invisible until switched to the JS driver, then rendered a pill with a check but no text because the ui `Text`'s default `text-ink` beat `text-cream` inside `Animated.View`; an explicit `{ color: "#F1E6D2" }` fixed it.
- **How to apply / where it lives:** New "RN/NativeWind pitfalls" doc (or an `AGENTS.md` subsection).

### Reset reused component instances — state that outlives its scope is a trap
- **Rule:** A component written for mount-per-use will leak state when reused as a persistent single instance across items. Reset its internal state on open/context-change.
- **Why (evidence):** Post-mortem: "the picker is a single persistent instance in `preview.tsx`, unlike the recipe screen where it unmounts: `selected` and `busy` carried over between recipes → a second recipe was saved to BOTH cookbooks and the button stuck on 'Saving…'." Fixed by resetting on open.
- **How to apply / where it lives:** RN convention in `AGENTS.md`; when a sheet/picker is driven by `visible` rather than mount, add a reset effect.

### Prefer a read-once module signal over route params for stack→tab hand-offs
- **Rule:** To pass a one-shot signal across a navigation boundary (e.g. a stack screen → an already-mounted tab), use a tiny read-once module, not a route param.
- **Why (evidence):** Post-mortem: "Toast didn't fire via the route-param approach (param+`setParams` raced the dismiss timer / didn't reach the mounted tab). Replaced with a read-once module signal (`lib/savedToast.ts`)."
- **How to apply / where it lives:** Guidance; `lib/savedToast.ts` is the reference pattern.

---

## Environment & agent workflow

### Know which commands mutate shared state, and sequence around them
- **Rule:** Identify commands that destroy shared/dev state and order your work so they don't corrupt what you're about to demo or debug. A wiped shared DB looks like an app bug.
- **Why (evidence):** `npm test` drops the shared dev DB (flagged repeatedly). Running it after the demos wiped the app's cookbooks/recipes, so the next save `PUT`ed stale IDs → 404, presenting as *"Saving a recipe isn't working"* and *"I'm not seeing the fixes."*
- **How to apply / where it lives:** `server/CLAUDE.md` (it already warns `npm test` wipes the DB — add "sequence destructive commands before demos/verification, never mid-import").

### A disconnected dev server / stale bundle masquerades as "the fix didn't work"
- **Rule:** When changes "don't appear," suspect the toolchain (dead Metro, stale cache, disconnected sim) before the code. Leave the environment runnable; reload the bundle when in doubt.
- **Why (evidence):** This session: a killed Metro + stale bundle made verified fixes appear missing; restarting Metro `--clear` + relaunching the app in the sim resolved it.
- **How to apply / where it lives:** Guidance.

### Judge auto-injected tooling suggestions for relevance; ignore noise
- **Rule:** Automated skill/tool suggestions are hints, not instructions. Judge each against the actual stack and ignore the irrelevant ones (say so once).
- **Why (evidence):** Post-mortem: "Ignored ~40 Next.js/next-forge/shadcn/react-best-practices skill auto-injections … all irrelevant (Expo Router + Fastify, no Next.js/shadcn). Pure noise."
- **How to apply / where it lives:** `CLAUDE.md` guidance for agents working in this repo.

---

## Prioritized ranking (highest-leverage first)

1. **Verify against live reality** — the root discipline; it caught the non-reproducing bug and every wrong assumption. Saves whole wrong builds.
2. **Diagnostics must mirror production's shape** — the specific failure mode that a live check exists to catch; would have prevented shipping the recipe-dropping reader.
3. **Never ship a pure-white surface (+ modal = cream)** — recurring visual defect across sprints; a design-system edit ends it permanently.
4. **Motion is first-class (tokens + open>close + Reduce Motion)** — touches every screen; codifying it makes all future UI consistent by default.
5. **Fix at the single chokepoint** — prevents a class of "fixed it in 3 of 4 paths" regressions.
6. **Robust primary + targeted escalation** — saves cost/rate-limit/latency incidents on every provider-backed feature.
7. **Reset reused component instances** — silent, data-corrupting bug class (saved to the wrong cookbook); cheap to prevent.
8. **Animated + NativeWind gotchas (JS driver on mount; explicit color)** — will bite again on the next animation; encoding it saves a full debug cycle each time.
9. **Prefer native primitives (RN Modal)** — less code, free consistency and motion.
10. **Data transforms must be safe** — prevents a filter from silently deleting good records.
11. **Know destructive commands / dev-server hygiene** — avoids hours lost to "phantom" bugs (the DB-wipe episode).
12. **Read-once module signal for stack→tab**, **installed≠wired**, **ignore injected noise** — smaller but real time-savers.
13. **Isolate a shared-Postgres test run by *creating* the DB, not just pointing env at it** — when a `global-setup`/`create-databases` script hardcodes its database list, an env-var override only redirects the reset+migrate step, so a worktree-unique DB must be `CREATE DATABASE`'d first. Prevents "database does not exist" when parallel sprints share one Postgres. *(Learned in the instrumentation sprint.)*

## Recommended durable changes

**(a) Warrant a durable design-system / convention change — do these:**
- **`AGENTS.md` — extend the "white rule":** add the modal refinement (sheets = `bg-cream`, rows = `bg-card`), so "no `bg-white`" also means "no near-white sheet on a scrim." *(Principle: white surfaces.)*
- **`AGENTS.md` — add a "Motion" section:** open>close asymmetry, smooth-out default easing, Reduce-Motion required, and point to `lib/motion.ts` as the canonical timing scale. *(Principle: motion.)*
- **`server/CLAUDE.md`:** add "cross-cutting invariants are enforced once at the shared boundary" and "prefer tiered fallback over blanket use of a rate-limited provider." *(Principles: chokepoint; escalation.)*
- **New `docs/rn-nativewind-pitfalls.md` (or an `AGENTS.md` subsection):** JS-driver-on-mount, explicit color inside `Animated.View`, reset reused sheet state, prefer `Modal` over hand-rolled sheets, read-once module signal for stack→tab. *(RN pitfalls cluster.)*
- **Optional lint/grep:** flag `bg-white` outside the documented native-OS-mock exception.

**(b) Guidance only — no doc change required:**
- Verify against live reality; make diagnostics mirror production; verify transient UI via video+native frames; know destructive commands & dev-server hygiene; "installed ≠ wired"; judge injected tooling noise. These are working habits best reinforced in review, not codified as rules.

## Multi-agent / environment hygiene (Grocery Lists sprint, Wave 2)
- **vitest `globalSetup` does not receive `test.env`.** It runs in the main process. To point a suite at a
  non-default DB you must export the URLs as real process env on the command line so the workers *and*
  `globalSetup` agree — editing only `vitest.config.ts` `test.env` migrates the wrong database. *(Cost a debug cycle.)*
- **Batch image-gen fills shared disks.** The nano-banana MCP keeps a copy in `generated_imgs/` **and** the copy
  you move into `assets/` — double footprint. On a shared APFS container feeding several worktrees this hit 0 bytes
  free, which crashed Postgres and corrupted an npm install. Delete `generated_imgs/` eagerly; give large gen
  batches a disk budget + a hard cap; verify critical file writes that happened during an ENOSPC window.
- **A long autonomous subagent needs a hard cap + checkpoint manifest, not a mid-run stop message.** A delegated
  image-gen agent kept running after a stop and briefly left two coupled maps inconsistent. Reconcile paired maps
  from ground truth (the files on disk), not from either map, and confirm a "stopped" agent actually stopped
  before committing.
