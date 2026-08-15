# Wave 2 — Feature Lead brief (CLARIFY gate)

You are the **Feature Lead** for one Wave-2 task of Harvest v1 (which task + its reference assets are in your
dispatch message). You will eventually run a full `/autonomous-sprint`, but **right now you are at the CLARIFY
gate only**: orient, analyze your reference material, and produce your **clarifying questions**. **Do NOT design,
write specs, or implement. Do NOT use `AskUserQuestion`.** Report your questions via `worker_done` and stop.
The coordinator consolidates every Wave-2 task's questions into ONE batch for the founder.

## The program (how your task fits)
Harvest v1 = save recipes, weekly meal plans, one-click grocery ordering. **Wave 1 (Cleanup) is DONE and merged
to `main`** — this worktree is based on it. Wave 2 is six tasks running in parallel (all depend only on
Cleanup). Read the workflow rules in `CLAUDE.md` ("Multi-agent sprint workflow") and the mechanics in
`docs/orchestration-runbook.md`.

## Read ALL eight v1 tasks (whole-product context — you own ONE, but understand the rest)
1. **Cleanup** — DONE/merged. See "current data model" below.
2. **Onboarding Improvements** — a recipes-screen onboarding checklist (Import your first recipe → add-recipe
   card; Unlock faster importing → shortcut setup; Create your first cookbook → create-cookbook card). The
   add-recipe card has "Import from social media" (Pinterest/TikTok/Instagram/YouTube — each a platform card
   with an instructions carousel + "Open X" and "Try with a sample recipe" using content from our e2e tests)
   and "Import from web" (paste-link). "Unlock faster importing" = a carousel to set up the Harvest share
   shortcut → opens the share menu.
3. **Meal Planning** — change week via back/forward arrows; highlight the current day ("Today"); add a recipe
   to a day → pick meal (Breakfast/Lunch/Dinner/Snack) → pick cookbook (incl. an "All recipes" cookbook) →
   pick recipe, with a search bar + filters (by ingredient — shows common ingredients with search — or total
   cook time); view assigned recipes on their day/meal; tapping one opens the recipe card; a deleted recipe is
   removed from all meal plans; add-to-meal-plan from the recipe screen (same UI, recipe pre-chosen).
4. **Grocery Lists** — add an ingredient via + → common ingredients or search → pick ingredient + quantity
   (smart-typed like Todoist, sensible default per ingredient); add a recipe's ingredients from the recipe
   screen ("groceries" → unselect items → adjust serving size → "Add X items" → toast "Added X items to
   grocery list — tap to view groceries"); view groceries grouped by aisle by default; sort by aisle / recipe
   / A–Z.
5. **Profile** — avatar icon top-right of the recipes screen → profile screen: username, logout (→ welcome
   screen), delete-data (→ welcome screen).
6. **Instrumentation** — Mixpanel: emit an event when the user continues past any onboarding screen, clicks any
   button, or completes any action. Needs a proposed comprehensive event/attribute set.
7. **Phone-based Auth** — real phone-based auth (replace the random test phone), gathered as the LAST step of
   onboarding and used to create the user. Provision a Twilio (or similar) number so the agent can receive
   verification codes and test without a human.
8. **Serverless Spike** — Wave 3, later.

## Current data model (what Cleanup merged — build on this, verify against the live schema)
Read `docs/sprint-cleanup/DESIGN.md` + `server/src/db/schema/` for exact shapes. Key facts:
- **recipes** own by `user_id` (creator; owner-only edit/delete → 404 for non-owner); have separated
  `ingredients` (`name`, `amount`, `unit`, `quantity_text` — structured & scalable), `servings` +
  `servings_estimated`, 8 Nutrition-Facts columns + `nutrition_source` (`parsed`|null — parsed-only; computed
  nutrition was punted).
- **cookbooks** + **cookbook_recipes** are the save mechanism (a recipe→cookbook row). `saved_recipes` and
  copy-on-write were removed. A user's library = recipes they own / their cookbook entries.
- **users** carry onboarding as typed **pg enums / enum[]** columns (`goals`, `recipe_sources`, `cook_days`,
  `when_cook`, `cook_time`, `how_heard`, `age`) + `onboarding_completed_at`. The mobile `lib/onboarding.ts`
  accumulator maps display labels → enum values and Cleanup wired the **signup `POST /v1/users`** at the end of
  onboarding (Phone Auth swaps in the real phone).
- `RecipeRepository.listOwned` exists but `GET /v1/recipes` is not yet exposed.

## Binding docs (follow exactly)
`CLAUDE.md`, `AGENTS.md` (design system: golden-hour tokens; **no pure `bg-white`** — sheets `bg-cream`, rows
`bg-card`; Lora/Karla; **Motion** via `lib/motion.ts`; honor Reduce Motion), `docs/harvest-principles.md`,
`docs/rn-nativewind-pitfalls.md`, `server/CLAUDE.md` (DBOS pipelines; Drizzle migrations-only; classes with
`static create()`; Zod-at-boundary; one chokepoint; **tests never hit the network**), `lib/motion.ts`.

## Reference assets (study the ones named in your dispatch)
- Recime walkthroughs + a screenshot in `~/Desktop/Business/Harvest/`: `onboarding-improvements.MP4`,
  `meal-plan-details.MP4`, `add-to-groceries-list-details.MP4`, `recipes-details.MP4`, `settings-details.MP4`,
  `display-meal-in-meal-plan.PNG`. Analyze video with the **`video-toolkit`** skill (ffmpeg frames / whisper).
- `~/workspace/heb-bot` — the ingredient/measurement + aisle data model (Grocery Lists).
- `server/tests/e2e/*` — the real sample import URLs (Onboarding's "Try with a sample recipe").

## Your CLARIFY-gate task (do this, then STOP)
- **Phase 0 (orient):** read the binding docs + the current data model; confirm this worktree runs (deps, the
  server test harness, the Expo app on the booted sim). Note anything surprising.
- **Phase 1 (reference analysis):** study your reference asset(s); write a short analysis to
  `docs/sprint-<task>/00-reference-analysis.md` (flows, states, the Recime behaviors to emulate, and where our
  design should diverge). Verify claims against the live app/code where you can.
- **Produce clarifying questions:** only decisions that genuinely change what you build (scope forks, approach
  choices the stories leave open, data-model or UX decisions, external-service choices). For EACH, give your
  **single recommended answer**. Skip anything with a sensible default — pick it and note it.
- **Report `worker_done`** with your clarifying questions (each with your recommended answer) in the body, and
  the path to your reference analysis. Do NOT design/spec/implement yet; the coordinator will bring the wave's
  consolidated questions to the founder, then run the DESIGN gate.
