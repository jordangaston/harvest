# Meal Planning — Sprint Report

Built to `DESIGN.md` + `WAVE2-DECISIONS.md`. Weekly meal plans: assign library recipes to a `day × meal`
slot, page weeks, mark today, open/remove assignments, add from a day or from a recipe card. Meal Planning
also **owns** the shared `GET /v1/recipes` list endpoint.

## What shipped

### Backend (S1, S2)
- **`GET /v1/recipes`** — the caller's library (owned ∪ cookbook recipes), deduped, keyset-paginated
  (`page_token`), with opt-in `expand=ingredient_names,cookbook_ids`. One `recipes` select with
  `OR EXISTS(cookbook membership)` (no UNION split) ordered by `(created_at, id)`.
- **`meal_slot` enum + `meal_plan_entries` table** (migration `0009_eager_the_watchers.sql`): flat entries
  `(user_id, date, meal, recipe_id, position, created_at)`, index `(user_id, date)`, **both FKs
  `ON DELETE CASCADE`** (recipe- and user-delete).
- **`GET /v1/meal-plan?start&end`** (inclusive range, ≤31 days, 400 `INVALID_RANGE`), **`POST /v1/meal-plan`**
  (append at `COALESCE(MAX(position),-1)+1`; 404 unknown recipe), **`DELETE /v1/meal-plan/:id`** (owner-scoped,
  204/404).
- Repositories/services follow `server/CLAUDE.md` (classes + `static create()`, Zod-at-boundary, one
  transaction for multi-row writes).

### Mobile (S3, S4)
- **`app/(app)/meal-plan.tsx`** rebuilt: Monday-start week + `‹ ›`, device-local "Today", day sections with
  token-tinted meal chips, tap→recipe, tap-to-remove (optimistic), FAB + day `+` add flow, "Add to groceries"
  **hook only**. Reads via `useMealPlanWeek` (client cache); mutations invalidate the `["mealPlan"]` prefix.
- **Add flow:** `MealMenu` → `AddRecipeSheet` (cookbook grid incl. synthetic "All recipes" → filtered recipe
  list: search + ingredient-AND + total-time), `IngredientFilterSheet` (Popular grid from
  `GET /v1/ingredients/common` **with hard-coded fallback**), `TotalTimeSheet`, and `AddToPlanSheet` from the
  recipe card (recipe pre-chosen → day-picker → meal).
- **Client cache** (`docs/client-caching.md`): new hooks in `lib/api/hooks.ts`; keys `mealPlan(weekStart)`,
  `recipes`, `commonIngredients`; no hand-rolled fetching.
- **Design system + motion:** no `bg-white` (`bg-cream` sheets / `bg-card` rows), Lora/Karla, `Modal
  slide` sheets, `Toast` on motion tokens honoring Reduce Motion; sheets reset state on `visible`.
- **Pure logic:** `lib/week.ts`, `lib/filterCards.ts`, checked by `lib/__checks__/meal-plan-checks.ts`.

## Verification
- **Server suite green offline: 26 files, 100 tests** (adds `meal-plan.test.ts` 9, `recipes-list.test.ts` 4).
  Tests never hit the network; ran isolated (see POSTMORTEM for the shared-DB workaround).
- **Mobile `tsc --noEmit`: clean.**
- **Pure-fn checks:** `node lib/__checks__/meal-plan-checks.ts` → all assertions pass.
- **Backend live demo:** `demos/S1-S2-backend-demo.md` (real DB, full flow incl. cascade + errors).
- **UI live demo:** `demos/meal-planning-demo.mp4` — **real on-device capture** (dedicated iOS 18.1 sim →
  Expo Go SDK 54 → Metro `:8092` → live backend `:3000`, 8 seeded recipes) showing the Meal Plan week view
  (S3) and the `Add a meal` menu (S4 AC1). Key frames: `demos/frame-0*.png`. The clip is **22s / truncated** —
  the shared machine deleted the sim mid-run (ENOSPC + OOM); the remaining sub-stories are mapped to code and
  driven through the live endpoints in `demos/S3-S4-ui-walkthrough.md`. See POSTMORTEM.

## Cross-task interfaces
- **Own:** `GET /v1/recipes` — base card `{id,title,image_url,total_minutes}` + `page_token`; expand fields
  omitted unless requested. Onboarding/Grocery consume.
- **Consume:** `GET /v1/ingredients/common` (Grocery-owned) — hard-coded fallback until it ships; swap is
  transparent.
- **Hook only:** the meal-plan "Add to groceries" button — Grocery wires the action.
- **Migration:** adds enum `meal_slot` + table `meal_plan_entries`. Generated as `0009`; the coordinator
  renumbers across parallel branches. Self-contained.

## Follow-ups / risks
1. **Sim visual pass** — a **real 22s on-device clip** + key frames now exist (`demos/meal-planning-demo.mp4`)
   covering S3 week view + S4 add-meal menu; the recording was truncated by the shared machine (ENOSPC/OOM
   deleting the sim mid-run). Re-run in a healthy env to film the full add→toast→remove→filters flow.
2. **Swipe-to-delete** punted to a tap affordance (no gesture pattern in the repo) — upgrade if gesture-handler
   is wired app-wide.
3. **Client-side filtering** loads the whole library — fine at v1 scale; move server-side if libraries grow.
4. **Ingredient AND** is free-text substring (no catalog) — can over/under-match; documented v1 ceiling.

## Files
- Server: `db/schema/{enums,meal-plan-entries,index}.ts`, `drizzle/0009_*.sql`, `models/{recipe,meal-plan}.ts`,
  `repositories/{recipe-repository,meal-plan-repository}.ts`, `services/{recipe-service,meal-plan-service}.ts`,
  `api/{app,schemas,errors}.ts`, `tests/integration/{meal-plan,recipes-list}.test.ts`.
- Mobile: `app/(app)/meal-plan.tsx`, `app/recipe/[id].tsx`, `lib/{week,filterCards}.ts`,
  `lib/__checks__/meal-plan-checks.ts`, `lib/api/{types,recipes,meal-plan,ingredients,hooks}.ts`,
  `components/recime/{MealMenu,AddRecipeSheet,IngredientFilterSheet,TotalTimeSheet,AddToPlanSheet,Toast,meals}.{tsx,ts}`.
- Docs: `specs/S1–S4`, `00-reference-analysis.md`, `01-clarify-questions.md`, `DESIGN.md`, `demos/`, this report, `POSTMORTEM.md`.
