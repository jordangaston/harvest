# Meal Planning — Clarifying Questions (each with my recommended answer)

Only decisions that genuinely fork the build. Minor calls are taken as defaults (see
`00-reference-analysis.md` → "Defaults I'm taking").

### Q1 — Meal-plan data model shape
Do we model assignments as a single flat table `meal_plan_entries(id, user_id, date, meal, recipe_id,
position, created_at)` — no parent "meal plan"/"week" entity — and allow **multiple recipes per
(day, meal) slot**?
- **Recommend: yes.** Flat entries keyed by absolute date; a slot is an ordered list of recipes. No
  container entity (weeks are just a date-range query). Matches Recime, keeps it boring.

### Q2 — Week start & date basis
Weeks are **Monday–Sunday**, and each entry stores an absolute calendar `DATE` (not a timestamp), with
"Today"/the current week computed on-device from the phone's local date?
- **Recommend: yes** — Monday-start (matches the reference `03 Aug–09 Aug 2026`), `DATE` column, client
  supplies the date string so there's no server timezone math.

### Q3 — "All recipes" cookbook + a new list endpoint
"All recipes" is a **synthetic** (non-DB) cookbook = every distinct recipe in the user's library
(recipes they **own** ∪ recipes in **any** of their cookbooks, deduped). This requires exposing a new
cursor-paginated **`GET /v1/recipes`** (today only `/:id`, PATCH, DELETE exist; `RecipeRepository.listOwned`
is the seed).
- **Recommend: yes** — add `GET /v1/recipes`; "All recipes" = owned ∪ cookbook entries, including
  owned-but-uncookbooked recipes.

### Q4 — Drop the Tags filter?
Recime's add sheet has `Tags | Ingredients | Total time`. We have **no tag concept** in the schema and
the brief lists only ingredient + total-time filters.
- **Recommend: drop Tags.** Ship Ingredients + Total time only.

### Q5 — "Common ingredients" list source + multi-select semantics
Our ingredients are **free-text names with no catalog**. For the "common ingredients" picker, use a
**curated static list** (~28 items, reusing the existing painterly `icon` keys) like Recime's "Popular",
plus free-text search; a recipe matches when its `ingredients.name` **contains ALL** selected terms
(pantry / intersection semantics)?
- **Recommend: yes** — curated static list (no new catalog infra), substring match on `ingredients.name`,
  **AND** across multiple selections. (Alternative if empties worry you: OR/union.)

### Q6 — Add-to-meal-plan from the recipe screen: how are day + meal chosen?
In the day flow, day is picked (tap `+` on a day) then meal (menu) then recipe. From the recipe screen
the **recipe** is known but day and meal are not — so the "identical UI, recipe pre-chosen" needs a
day+meal picker the video never shows.
- **Recommend:** the recipe-screen sheet shows the current week's **day list** (with `‹ ›` arrows) →
  tap a day → the same Breakfast/Lunch/Dinner/Snack menu → confirm → toast. Recipe stays fixed.

### Q7 — "Add to groceries" button scope
The week view shows an `Add to groceries` button (PNG), but groceries are a **separate Wave-2 task**.
- **Recommend: exclude from Meal Planning.** We leave the placement/hook; the Grocery Lists task wires
  the action. Prevents two parallel Leads colliding on the same feature.

### Q8 — Drop the "Add note" tab?
Recime's add sheet has a `Choose recipes | Add note` tab to attach free text to a slot. Not in our brief;
no note field in our model.
- **Recommend: drop it** (YAGNI). Revisit only if you want per-meal notes.
