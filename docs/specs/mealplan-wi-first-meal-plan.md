# WI — First meal plan: generator port, mealplan tools, objective, kick-off recovery

## Background

When onboarding completes, the objective loop (PR #87) pops it and kicks off the next objective on
the stack — but nothing is on the stack, and the Chef has no meal-planning tools. This WI ships the
first successor objective: Sage generates the household's first meal plan, elicits feedback, revises
by user-driven search-and-pick, and gets a final confirmation.

**What exists:**
- **Durable plan state:** `meal_plan_entries` — per-user `(date, meal, recipeId, position)` rows; a
  slot may hold several entries (main + sides, main-first by `position`). `MealPlanService`
  `add`/`remove`/`listRange` are the entry-level mutations.
- **A generator — unmerged and stale.** PR #45 (closed, branch `jordangaston/mealplan-design`)
  implements Option B: `MealPlanGeneratorService.generate` (MMR + bounded-swap repair via
  `MmrFiller`), `slotOptions` (ranked, tiered, recency-clean, MMR-diversified top-N per slot with an
  `exclude` id set), `fillSlot`, `CandidateProvider` (single chokepoint pool builder over
  `RankingEngine`), plus a `meal_plan_entries.source` (`generated`/`manual`) migration. The branch is
  ~233 commits behind main and predates the food-preference rewrite (`FoodPref` directives,
  `plate.ts`, current `UserPreferences`).
- **Plate composition:** `completePlate` (`ranking/plate.ts`) — main + sides for one slot from
  meal-slot `more` directives. The stale generator predates it (fills one main per slot).
- **The objective machinery:** `update_tasks` completes-and-pops in-loop; the consumer drain loop
  runs a triggerless kick-off after a pop (continue-iff-popped). Deferred from PR #87: **kick-off
  crash-recovery** — a crash between a pop and its kick-off strands the successor (a `ponytail:`
  comment in `consumer.ts` marks the gap).

**Decisions settled in design discussion:**
- The revision loop is **not** modeled as tasks. The plan is durable state; a small fixed task set
  (generate → feedback → confirm) plus tools the model calls repeatedly. No dynamic task pushing, no
  plan-level `confirmed` flag — confirmation = the objective completing.
- **The user drives swaps.** No system re-roll: the user says what they want in a slot, the model
  searches with those criteria, the user picks or asks for more options.
- Slots hold **multiple recipes** (main + sides) → tools are entry-level add/remove, not
  slot-replace. `fillSlot`'s `replaceSlot` semantics must not survive the port.
- Tool ids are namespaced `namespace__verb` (see `docs/specs/chef-wi-tool-namespaces.md`, which
  lands first).

## Objective

Port the meal-plan generator onto current main, expose it to the Chef as four `mealplan__*` tools
(with a per-request criteria filter on slot options and entry-level add/remove), define and seed a
`first_meal_plan` objective that runs generate → feedback → confirm, and close the deferred
kick-off crash-recovery gap so onboarding chains into it durably.

## Deliverables

1. **Generator port** — bring `server/src/planning/*` (+ the `meal_plan_entries.source` migration)
   from `origin/jordangaston/mealplan-design` onto main, adapted to the current preference model
   (`FoodPref` directives, current `UserPreferences`, current repositories). `generate` composes
   plates: after picking a main per slot, run `completePlate` so meal-slot `more` directives add
   sides (persisted as additional entries in the slot). Drop `regenerateSlot` (no system re-roll);
   `fillSlot` becomes an **append** (`MealPlanService.add` semantics + `source: 'manual'`), not
   `replaceSlot`.
2. **Criteria hook** — `slotOptions` (and `CandidateProvider.candidates`) accept optional one-shot
   `criteria`: include/exclude over the dimensions the ranking layer already understands
   (ingredient, cuisine, dish type, food category) plus `max_total_minutes`. Reuses
   `directive-match`/`eligible` as transient constraints — never persisted as prefs. The existing
   `exclude` recipe-id set stays as the "more options" pagination axis.
3. **Four chef tools** (born namespaced):
   - `mealplan__generate` — fill the household's week; returns the plan for Sage to present.
   - `mealplan__slot_options(date, meal, criteria?, limit, exclude_ids?)` — ranked, diversified
     options honoring the user's ad-hoc criteria; "more options" = call again excluding shown ids.
   - `mealplan__add_recipe_to_slot(date, meal, recipe_id)` — append an entry (main or side).
   - `mealplan__remove_recipe_from_slot(date, meal, recipe_id)` — remove one entry.
4. **`first_meal_plan` objective** — definition + tasks, pushed `bottom` (suspended) when onboarding
   is seeded, so onboarding's pop lands on it:
   - `generate` (required `emit`): call `mealplan__generate`, present the plan.
   - `feedback` (required fact-less `elicit`): "anything you'd change?" — "no/looks good" fills it.
   - `confirm` (required fact-less `elicit`, gated `after` feedback): final confirmation; filling it
     completes and pops the objective via `tasks__update`.
   Resident tools: the four `mealplan__*` tools + `facts__read` + `tasks__update` + `chat__send`
   (+ `recipes__import`).
5. **Fact-less elicit fill** — `tasks__update` accepts an `elicit` with no `factType`: mark `filled`,
   no fact write (today it rejects them). This is how `feedback`/`confirm` complete. The
   explainer-ack keeps its consumer-driven path unchanged (it is `solo` and never surfaced to
   `tasks__update` during onboarding's flow).
6. **Kick-off crash-recovery** (closes PR #87's deferred AC-10): a durable marker on the objective
   row — set when `completeAndPop` activates a successor, cleared once a kick-off turn against it
   delivers — plus a re-entry arm in the consumer drain loop: continue also when the active
   objective carries the marker, so a bare doorbell resumes a stranded kick-off. Idempotent under
   redelivery (kick-off sends already dedupe on the objective id).

`[ASSUMPTION: the plan's owner is the thread's ownerUserId — meal_plan_entries is per-user and the
generator is per-user; household-member-scoped plans are out of scope.]`
`[ASSUMPTION: the first plan's window is the next 7 days starting tomorrow, with slots derived from
the household's recorded facts (dinners/lunches/breakfasts per week, cook_days). If a needed fact is
missing, generate what the facts support — the plan is best-effort by design.]`

## Acceptance Criteria

- **AC-1 — port compiles against main and its suite passes.** Given the ported `planning/*` module
  and migration, when `pnpm typecheck && pnpm test` run, then all green (ported tests adapted; only
  the pre-existing `media.test.ts` failure remains).
- **AC-2 — generate persists a multi-entry plan.** Given a household with recorded meal counts/cook
  days and a recipe corpus with sides, when `mealplan__generate` runs, then `meal_plan_entries`
  holds one main per generated slot (source `generated`), plus sides for any meal-slot `more`
  directive the main misses, ordered main-first by `position`.
- **AC-3 — criteria filter bites.** Given a slot and criteria (e.g. include ingredient "fish",
  `max_total_minutes: 30`), when `mealplan__slot_options` runs, then every returned option matches
  the criteria, and calling again with the shown ids in `exclude_ids` returns fresh options.
- **AC-4 — entry-level add/remove.** Given a slot holding a main + side, when
  `mealplan__remove_recipe_from_slot` removes the side and `mealplan__add_recipe_to_slot` adds a
  replacement, then the main is untouched and the slot holds the new pair; the added entry's source
  is `manual` so a later regenerate won't overwrite it.
- **AC-5 — onboarding chains into first_meal_plan.** Given `first_meal_plan` seeded suspended under
  onboarding, when onboarding completes and pops, then the drain loop's kick-off turn runs against
  `first_meal_plan` with the `mealplan__*` tools resident.
- **AC-6 — fact-less elicit fill.** Given the `feedback` task, when `tasks__update` fills it with no
  factType, then it is `filled` with no fact row written; `confirm` (gated after `feedback`) becomes
  eligible; filling `confirm` completes and pops the objective in-loop.
- **AC-7 — crash-recovery re-entry.** Given onboarding popped and the marker set on
  `first_meal_plan`, when the process dies before the kick-off and the doorbell redelivers, then a
  fresh `handle` re-enters the kick-off (marker present), delivers the opener exactly once (guid
  dedup), and clears the marker; a subsequent bare doorbell no-ops.
- **AC-8 — explainer-ack unchanged.** Given onboarding's ack, when the suite runs, then its
  unasked→asked→filled lifecycle is untouched.

## Test Cases

### TC-1 — ported generator fills a week (AC-1, AC-2)
**Preconditions:** Test DB; seeded recipes incl. `side_dish` dish types; a user with prefs incl. one
meal-slot `more` directive (e.g. "veg with every dinner").
**Steps:** Run the ported `generate` for a 7-day window.
**Expected Outcomes:** Entries persisted per slot from the user's meal counts; the dinner slots whose
main misses the veg directive carry a veg side entry after the main; all entries `source: 'generated'`.

### TC-2 — criteria filter + more-options pagination (AC-3)
**Preconditions:** Corpus with fish and non-fish recipes, varied `totalMinutes`.
**Steps:** `slotOptions(date, 'dinner', { include: { ingredient: 'fish' }, max_total_minutes: 30 },
limit 3)`; then again with the 3 returned ids in `exclude_ids`.
**Expected Outcomes:** All options are fish ≤30min; second call returns 3 different fish options
(or fewer when the corpus runs out — never a repeat).

### TC-3 — add/remove entries in a slot (AC-4)
**Preconditions:** A slot with a generated main + side.
**Steps:** Remove the side; add a different recipe to the slot.
**Expected Outcomes:** Main untouched; new entry present with `source: 'manual'`; a re-generate of
the week leaves the manual entry in place.

### TC-4 — onboarding pops into first_meal_plan kick-off (AC-5)
**Preconditions:** Consumer-logic harness; thread seeded with onboarding active +
`first_meal_plan` suspended (the new seeding path); scripted chef.
**Steps:** Complete onboarding's last task via the tool path; let the drain loop continue.
**Expected Outcomes:** Kick-off turn runs against `first_meal_plan`; its briefing lists the
generate/feedback/confirm tasks; the turn's sends key on the first_meal_plan objective id.

### TC-5 — fact-less elicit lifecycle (AC-6)
**Preconditions:** `first_meal_plan` active with `generate` filled.
**Steps:** Fill `feedback` via `tasks__update` (no value/factType); then fill `confirm`.
**Expected Outcomes:** `feedback` `filled`, no fact row; `confirm` eligible only after `feedback`;
filling `confirm` returns `objectiveComplete: true, popped: true`.

### TC-6 — stranded kick-off recovers (AC-7)
**Preconditions:** Two-objective stack; scripted chef that pops A then crashes before B's kick-off
delivers.
**Steps:** Run `handle` (crash mid-kick-off); redeliver the doorbell; run `handle` again; run a
third bare `handle`.
**Expected Outcomes:** Second `handle` re-enters via the marker and delivers B's opener exactly once;
marker cleared; third `handle` no-ops.

### TC-7 — ack regression gate (AC-8)
**Preconditions:** Existing onboarding tests.
**Steps:** Run the suite.
**Expected Outcomes:** Ack lifecycle tests unchanged and green.

## Test Run

_To be filled during execution. Full `server/` suite must pass (only the pre-existing
`media.test.ts` ffmpeg failure)._

## Deployment Strategy

Direct deploy, sequenced **after** the tool-namespace WI. The new path only activates for threads
whose onboarding completes after deploy (existing mid-onboarding threads get `first_meal_plan`
seeded only via the new seeding path — threads seeded before this deploy have nothing below
onboarding and behave exactly as today). `[ASSUMPTION: no backfill for already-onboarded threads;
their first plan waits for a later trigger — acceptable for the current test-household stage.]`
Verify on the chef-sim/ime-turn harness before the founder demo.

## Production Verification

### PV-1 — end-to-end first plan over iMessage
**Preconditions:** Real test thread; fresh onboarding.
**Steps:** Complete onboarding; observe the close; then the kick-off.
**Expected Outcomes:** Sage delivers the close, then presents a generated week (mains + any directive
sides) without any new inbound; asks for feedback.

### PV-2 — user-driven swap
**Preconditions:** PV-1 done; plan presented.
**Steps:** Reply "swap Tuesday dinner for something with fish under 30 minutes"; pick one of the
options; then say "more options" on another slot.
**Expected Outcomes:** Options are fish ≤30min; the pick lands in the slot (`manual`); "more
options" returns fresh candidates; final "looks good" completes the objective.

## Production Verification Run

_To be filled after deployment._
