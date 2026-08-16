---
tags: [meal-planning, wave-2], tdd
summary: "Meal Planning technical design document"
locked: false
---

Built to `WAVE2-DECISIONS.md` (authoritative) and `00-reference-analysis.md`. Authored with
`/writing-design-documents`; edited with `/writing-clearly-and-concisely`.

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Scope

A weekly meal plan: assign library recipes to a `day × meal` slot, page through weeks, see the current
day, open a slot's recipe card, and remove an assignment. A deleted recipe leaves every plan
automatically. Meal Planning also **owns** the shared `GET /v1/recipes` list endpoint that Onboarding and
Grocery consume.

**In scope:** the `meal_plan_entries` table + `meal_slot` enum; three meal-plan endpoints; `GET /v1/recipes`;
the rebuilt meal-plan screen; the add-recipe sheet (search + ingredient/time filters) reached from a day or
from a recipe card.

**Out of scope (owned elsewhere, per decisions):** the "Add to groceries" button *action* (Grocery); the
common-ingredients catalog (Grocery); `users.name` and auth (Phone Auth); Mixpanel wiring (Instrumentation —
we only emit the named domain events). **Dropped:** the Tags filter and the Add-note tab (no data model; not
in the brief).

# Use Cases

- **F-01 View the week** — see Mon–Sun for a week, the current day marked "Today", each slot's recipes.
- **F-02 Add from a day** — tap `+` on a day → pick meal → pick cookbook (incl. "All recipes") → search/filter → pick recipe.
- **F-03 Add from a recipe card** — recipe pre-chosen → pick a day → pick meal.
- **F-04 Open a slot recipe** — tap an assigned recipe → its recipe card.
- **F-05 Remove a slot recipe** — swipe a row → the assignment is gone.
- **F-06 Deleted recipe cascades** — deleting a recipe removes it from every plan.
- **O-01 List library recipes** — owned ∪ cookbook-entry recipes, deduped, cursor-paginated (the `GET /v1/recipes` others consume).
- **O-02 Filter recipe cards** — client-side by search text, ingredient names (AND), and total-time bucket.

---

# Use Case Implementations

## Add from a day — Implements F-02

~~~mermaid
sequenceDiagram
    participant U as User
    participant MP as MealPlan screen
    participant Sheet as AddRecipeSheet
    participant API as Fastify /v1
    participant DB as Postgres

    U->>MP: tap + on "Thursday 6"
    MP->>U: MealMenu (Breakfast/Lunch/Dinner/Snack)
    U->>MP: tap "Lunch"
    MP->>Sheet: open(date=2026-08-06, meal=lunch)
    rect rgb(240,248,255)
    note over Sheet,API: Cookbook grid
    Sheet->>API: GET /v1/cookbooks
    API-->>Sheet: cookbooks[] (+ synthetic "All recipes")
    end
    U->>Sheet: tap a cookbook tile
    rect rgb(255,248,240)
    note over Sheet,API: Recipe cards + client-side filter
    Sheet->>API: GET /v1/recipes?expand=ingredient_names,cookbook_ids
    API->>DB: listCards(userId) (owned ∪ cookbook, deduped)
    DB-->>API: cards[]
    API-->>Sheet: cards[] (paged; loads all pages)
    note over Sheet: filter by cookbook_ids, search, ingredients(AND), time
    end
    U->>Sheet: tap a recipe
    Sheet->>API: POST /v1/meal-plan {date, meal, recipe_id}
    API->>DB: insert entry (position = max+1 in slot)
    DB-->>API: entry + recipe card
    API-->>Sheet: 201 entry
    Sheet-->>MP: onAdded → refetch week, toast "Added to Lunch"
~~~

## Add from a recipe card — Implements F-03

~~~mermaid
sequenceDiagram
    participant U as User
    participant RC as Recipe card
    participant Sheet as AddToPlanSheet
    participant API as Fastify /v1
    U->>RC: tap "Add to meal plan"
    RC->>Sheet: open(recipeId) — recipe pre-chosen
    Sheet->>U: day list (‹ › week arrows)
    U->>Sheet: tap a day
    Sheet->>U: MealMenu
    U->>Sheet: tap a meal
    Sheet->>API: POST /v1/meal-plan {date, meal, recipe_id}
    API-->>Sheet: 201 entry
    Sheet-->>RC: toast "Added to <Meal> · <day>"
~~~

## View the week — Implements F-01

~~~mermaid
sequenceDiagram
    participant U as User
    participant MP as MealPlan screen
    participant API as Fastify /v1
    participant DB as Postgres
    U->>MP: open Meal Plan tab (or tap ‹ / ›)
    note over MP: weekStart = Monday of the shown week (device-local)
    MP->>API: GET /v1/meal-plan?start=2026-08-03&end=2026-08-09
    API->>DB: join meal_plan_entries + recipes where user & date in [start,end]
    DB-->>API: entries + recipe cards
    API-->>MP: entries[]
    note over MP: group by date→meal; mark today; render Mon–Sun
~~~

## Remove a slot recipe / cascade — Implements F-05, F-06

~~~mermaid
sequenceDiagram
    participant U as User
    participant MP as MealPlan / Recipe card
    participant API as Fastify /v1
    participant DB as Postgres
    alt F-05 remove one assignment
      U->>MP: swipe a slot row
      MP->>API: DELETE /v1/meal-plan/:id
      API->>DB: delete where id & user_id
      DB-->>API: rowCount (0 → 404)
      API-->>MP: 204
    else F-06 delete the recipe
      U->>MP: delete recipe (DELETE /v1/recipes/:id)
      API->>DB: delete recipe
      note over DB: meal_plan_entries.recipe_id ON DELETE CASCADE → entries vanish
    end
~~~

---

# Entities

~~~mermaid
classDiagram
    class User { +uuid id }
    class Recipe {
      +uuid id
      +string title
      +string imageUrl
      +int totalMinutes
    }
    class Cookbook { +uuid id +string name }
    class MealPlanEntry {
      +uuid id
      +Date date
      +MealSlot meal
      +int position
    }
    class MealSlot { <<enum>> breakfast lunch dinner snack }
    User "1" --> "*" MealPlanEntry : plans
    MealPlanEntry "*" --> "1" Recipe : assigns
    User "1" --> "*" Recipe : owns
    Cookbook "*" --> "*" Recipe : holds (cookbook_recipes)
~~~

A meal plan is not an entity — it is just the set of a user's `MealPlanEntry` rows in a date range. No
week or plan container.

---

# Tables

## meal_plan_entries (new)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | pk, default gen_random_uuid() | |
| user_id | uuid | not null, fk users(id) on delete cascade | account deletion clears the plan |
| date | date | not null | absolute calendar date; no timezone |
| meal | meal_slot | not null | enum below |
| recipe_id | uuid | not null, fk recipes(id) **on delete cascade** | **F-06**: deleted recipe leaves all plans |
| position | integer | not null | order within a (date, meal) slot |
| created_at | timestamptz | not null, default now() | |

**Enum `meal_slot`** (new pg enum): `breakfast · lunch · dinner · snack`.

**Index** `meal_plan_entries_user_date_idx` on `(user_id, date)` — backs the week-range query (F-01). No
unique constraint: a slot holds many recipes, ordered by `position`.

## No other table changes

`GET /v1/recipes` reads existing `recipes` / `cookbook_recipes` — no schema change.

---

# Modules

~~~mermaid
classDiagram
    class MealPlanService {
      +listWeek(userId, start, end) MealPlanEntryView[]
      +add(userId, date, meal, recipeId) MealPlanEntryView
      +remove(userId, entryId) void
    }
    class MealPlanRepository {
      +listRange(userId, start, end) MealPlanEntryView[]
      +add(userId, date, meal, recipeId) MealPlanEntryView
      +remove(userId, entryId) boolean
    }
    class RecipeRepository {
      +listCards(userId, opts) Page~RecipeCard~
      +listOwned(userId) Recipe[]
    }
    class RecipeService { +listCards(userId, opts) Page~RecipeCard~ }
    MealPlanService --> MealPlanRepository
    RecipeService --> RecipeRepository
~~~

~~~mermaid
flowchart LR
    Screen[MealPlan screen] -->|start,end| MPApi[GET /v1/meal-plan]
    Sheet[AddRecipeSheet] -->|expand| RApi[GET /v1/recipes]
    Sheet -->|date,meal,recipe_id| POST[POST /v1/meal-plan]
    MPApi --> MPSvc[MealPlanService] --> MPRepo[(meal_plan_entries)]
    RApi --> RSvc[RecipeService] --> RRepo[(recipes ∪ cookbook_recipes)]
~~~

- **Backend** follows `server/CLAUDE.md`: classes with `static create()`, Zod-parse at the repo boundary,
  `db.transaction` for multi-row writes, no DI container. `MealPlanEntryView` = entry + a joined recipe card
  `{ id, title, image_url }`.
- **`RecipeRepository.listCards`** is a new method beside `listOwned`: `recipes` owned by the user `UNION`
  distinct recipes joined through the user's `cookbook_recipes`, deduped by id, `created_at desc`,
  cursor-paginated by `(created_at, id)`. `expand` adds `ingredient_names` (agg from `ingredients.name`) and
  `cookbook_ids` (agg from `cookbook_recipes`).
- **Mobile** adds `lib/api/meal-plan.ts` and extends `lib/api/recipes.ts`, both over the existing
  `apiFetch<T>` client. Sheets follow the `CookbookPickerSheet` pattern (`Modal transparent
  animationType="slide"`, `bg-black/30` scrim, `bg-cream` sheet, `bg-card` rows) and **reset state on
  `visible`** (reused-instance rule, `docs/rn-nativewind-pitfalls.md`).

---

# APIs

## List recipes `GET /v1/recipes`

The caller's library — recipes they own ∪ recipes in any of their cookbooks, deduped. Cursor-paginated.
**Owned by Meal Planning; consumed by Onboarding and Grocery.** Requires bearer token.

### Request
- Headers: `authorization: Bearer <jwt>`
- Query: `page_token?: string`, `page_size?: int (default 50, max 200)`, `expand?: csv` of `ingredient_names`, `cookbook_ids`

### Success Response `200`
- Body
  - recipes: array of
    - id, title: string
    - image_url: string | null
    - total_minutes: int | null
    - ingredient_names: string[] *(only when expanded)*
    - cookbook_ids: string[] *(only when expanded)*
  - page_token: string | null

### Unauthorized Response `401`
- Body: error { code: "UNAUTHORIZED", message }

## Get the week's plan `GET /v1/meal-plan`

Entries for the caller between two dates (inclusive), each with a recipe card. Requires bearer token.

### Request
- Query: `start: YYYY-MM-DD` (required), `end: YYYY-MM-DD` (required)

### Success Response `200`
- Body
  - entries: array of
    - id, date (YYYY-MM-DD), meal (breakfast|lunch|dinner|snack), position: int
    - recipe: { id, title, image_url }

### Bad Request Response `400`
- Missing/invalid `start`/`end`, or a range wider than 31 days. error { code: "INVALID_RANGE", message }

## Add an assignment `POST /v1/meal-plan`

Assigns a recipe to a `date × meal`, appended to the slot. Requires bearer token.

### Request
- Body: entry: { date: YYYY-MM-DD, meal: breakfast|lunch|dinner|snack, recipe_id: uuid }

### Success Response `201`
- Body: entry: { id, date, meal, position, recipe: { id, title, image_url } }

### Not Found Response `404`
- `recipe_id` does not exist. error { code: "RECIPE_NOT_FOUND", message }

## Remove an assignment `DELETE /v1/meal-plan/:id`

Removes one of the caller's entries. Owner-scoped — another user's id reads as not found.

### Success Response `204` — no body
### Not Found Response `404` — error { code: "ENTRY_NOT_FOUND", message }

---

# Mobile screens & flows

**`app/(app)/meal-plan.tsx` (rebuild — today a static stub).**
- Header "My Meal Plan" (Lora heading). The Recime `…` overflow has no in-scope actions → omitted for v1
  (Q-01).
- Week strip `‹ 03 Aug 2026 – 09 Aug 2026 ›`; arrows shift `weekStart` ±7 days. `weekStart` = Monday of the
  shown week, from the device-local date. Motion: label cross-fades on change (`lib/motion.ts`; skip under
  Reduce Motion).
- Mon–Sun sections. The current day renders `Today • Friday 7` in `text-brand`; others in `text-ink`. Each
  day header has a `+` (opens `MealMenu` for that date). Empty day → muted "No recipes yet".
- Slot rows: thumbnail + title + a **meal chip** tinted from golden-hour tokens (four soft pastel tints, not
  Recime's blue/yellow), all AA-contrast. Tap a row → recipe card (`app/recipe/[id]`). **Swipe-to-delete**
  removes the entry (F-05), optimistic with rollback on error.
- **FAB `+`** (bottom-right, `bg-brand`): adds to **today** (opens `MealMenu` for today) (Q-02).
- **"Add to groceries" button**: rendered in the reserved slot above the day list; `onPress` hands the
  visible week's `recipe_id`s to Grocery (see Cross-task) — Meal Planning owns placement, Grocery owns the
  action (Q-03).

**Add-recipe components (new, `components/recime/`).**
- `MealMenu` — small slide sheet: Breakfast/Lunch/Dinner/Snack with icons.
- `AddRecipeSheet` — near-full-height slide sheet, props `{ visible, date, meal, recipeId? }`. Header
  "Add to {Meal}", search bar, filter chips **Ingredients ▾ / Total time ▾**. Level 1: cookbook tiles
  (`All recipes` synthetic tile first, then real cookbooks). Level 2: recipe cards for the chosen cookbook,
  filtered client-side; tap → `POST /v1/meal-plan` → toast (`lib/savedToast.ts`).
- `IngredientFilterSheet` — "What's in your pantry?" search + a **Popular grid** of common ingredients
  (icons) from Grocery's catalog (Cross-task); multi-select, **AND** match on `ingredient_names`.
- `TotalTimeSheet` — radios Under 15 / 30 / 60 mins + Clear/Apply; matches on `total_minutes` (null excluded).
- `AddToPlanSheet` (F-03, from `app/recipe/[id].tsx`) — recipe pre-chosen; a day-picker (week `‹ ›`) then
  `MealMenu`.

All sheets: `Modal animationType="slide"`, `bg-cream` surface, `bg-card` rows, reset on `visible`, honor
Reduce Motion, open slower than they close.

---

# Cross-task interfaces

| Interface | Direction | Contract |
|---|---|---|
| `GET /v1/recipes` | **We own** | Shape above. Onboarding checks existence/count; Grocery lists cards. Base is lean; `expand` is opt-in so consumers pay only for what they use. |
| Common ingredients | **We consume** (Grocery owns) | `GET /v1/ingredients/common` (or read `server/seed/grocery-catalog.json`) → `[{ canonicalName, iconKey }]` for the Popular grid. **Fallback** if unavailable at integration: a small hard-coded list, replaced on merge (Q-04). |
| "Add to groceries" button | **Shared** | We render the button + navigate to Groceries with the week's `recipe_id`s; Grocery implements the add. Needs the Grocery Lead's nav-param contract (Q-03). |
| Migrations | Parallel | We add one migration (`meal_slot` enum + `meal_plan_entries`); its 0009+ number will collide across branches — the coordinator reconciles order at integration. Self-contained. |

---

# Testing (offline — never hits the network)

## Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| O-01 list recipes (owned ∪ cookbook, dedup, page, expand) | Op | x | x | |
| O-02 filter cards (search / ingredient AND / time) | Op | x | | |
| F-01 view week | Flow | | x | demo |
| F-02 add from day | Flow | | x | demo |
| F-03 add from recipe | Flow | | | demo |
| F-05 remove | Flow | | x | demo |
| F-06 cascade | Flow | | x | demo |

## Approach
- **Unit** — `MealPlanRepository` (`listRange` grouping/join, `add` position = max+1, `remove` owner scope)
  and `RecipeRepository.listCards` (dedup, cursor, expand aggregates) against the local test Postgres. The
  client-side filter is a **pure function** (`filterCards(cards, {search, ingredients, maxMinutes})`) unit-tested
  in the mobile package — the one runnable check that fails if AND/substring/time logic breaks.
- **Integration** — routes via `buildApp()` against the migrated local PG (`tests/helpers/global-setup.ts`):
  auth (401), `POST`→`GET` round-trip, `DELETE` 204 + cross-user 404, `GET /v1/recipes` dedup + pagination +
  expand, and **F-06**: insert an entry, `DELETE /v1/recipes/:id`, assert the entry is gone.
- **E2E / manual demo** on the booted sim, one per Flow: week nav + Today, add-from-day (with both filters),
  add-from-recipe, swipe-remove, cascade.
- **Infra:** no new harness — reuse `global-setup`. Add a `mealPlanEntry` row factory in test helpers.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-compatible |
|---|---|---|---|
| 1 | schema | Create enum `meal_slot`; create table `meal_plan_entries` + index | yes (additive) |

`GET /v1/recipes` is a code-only addition (no migration). The migration can run before the code deploys.

## Rollback
Code and migration roll back independently (the new table is unused by old code). To fully revert: drop
`meal_plan_entries` then the `meal_slot` enum.

---

# Monitoring

Pre-launch, client-only. No server metrics. We emit named domain events for Instrumentation to route to
Mixpanel (Title-Case `Object Action`, no-op when the token is unset): **Meal Plan Recipe Added**
(props: `meal`, `source` = `day` | `recipe_card`), **Meal Plan Recipe Removed**, **Meal Plan Week Changed**
(prop: `direction`). No new alerts or dashboards.

---

# Decisions

## Flat `meal_plan_entries`, many recipes per slot
**Framework:** Direct criterion — match the founder decision; least structure that holds.
**Choice:** One row per assignment keyed by absolute `date`; a "week"/"plan" is a date-range query, not an
entity. Ordering within a slot is `position`.
### Alternatives
- **A `meal_plans`/`weeks` parent table:** rejected — no attribute lives on a week; pure overhead.
- **One recipe per slot (unique constraint):** rejected — the reference shows multiple recipes per day.

## One enriched `GET /v1/recipes` + client-side filtering
**Framework:** Fermi ROI — a personal library is tens of recipes (rarely >200); loading all cards and
filtering in memory is milliseconds and zero query infra, versus building server-side search/filter params.
**Choice:** The sheet loads all pages once and filters (search, ingredient AND, time) client-side via a pure
function. `expand` keeps the base payload lean for other consumers.
`// ponytail: client-side filter over the full library; move to server query params if libraries grow large.`
### Alternatives
- **Server-side filter query params:** rejected for v1 — infra cost with no scale benefit yet.

## `start`/`end` date params (not a `week` param)
**Framework:** Direct criterion — avoid server timezone math.
**Choice:** The client computes Monday–Sunday from the device's local date and sends explicit dates; the
server filters a range and does no calendar arithmetic.

## No library-membership check on add
**Framework:** Direct criterion — recipes are shared-readable (any authed caller can `GET /v1/recipes/:id`),
and the add sheet only surfaces the caller's library. The `recipe_id` FK guarantees existence.
**Choice:** Validate existence (404 on unknown id) but not ownership/membership.

## Cascade via FK `ON DELETE CASCADE`
**Framework:** Direct criterion — one chokepoint; mirrors `ingredients` and `cookbook_recipes`.
**Choice:** `meal_plan_entries.recipe_id → recipes.id ON DELETE CASCADE` satisfies F-06 with no app code.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Does the header `…` overflow need any action (e.g. clear week)? Not in the brief. | open | Default: omit for v1. |
| Q-02 | Should the FAB `+` add to **today**, or open a day-picker first? | open | Default: add to today. |
| Q-03 | "Add to groceries" handoff — nav params vs a Grocery-provided component; who renders the button? Needs the Grocery Lead. | open | Proposed: we render + navigate with the week's recipe ids. |
| Q-04 | Common-ingredients delivery — `GET /v1/ingredients/common` vs reading `grocery-catalog.json`, and its availability at integration. Needs the Grocery Lead. | open | Consume the endpoint; static fallback until ready. |
| Q-05 | Do Onboarding/Grocery need any `GET /v1/recipes` field beyond the lean card? | open | Confirm at integration; `expand` covers extras. |
| Q-06 | May the same recipe appear twice in one slot? | open | Default: allow (no unique constraint). |

---

# Risks

1. **Cross-task coupling (highest).** Three seams run in parallel branches — `GET /v1/recipes` (we produce,
   two consume), common-ingredients (we consume), and the "Add to groceries" button (shared). Contract drift
   or `meal-plan.tsx` collisions are the top integration risk. *Mitigation:* the wire contracts above +
   coordinator reconciliation; the static ingredient fallback unblocks us if Grocery lags.
2. **Migration-number collision** across parallel 0009s — expected; kept self-contained for the coordinator to reorder.
3. **Client-side filter ceiling** — loads the whole library; fine at v1 scale, degrades for very large libraries (ceiling noted in code).
4. **Ingredient-filter precision** — recipe ingredients are free text with no catalog, so substring match can over-match ("chicken" ⊃ "chicken stock"). Acceptable for v1.
5. **"Today"/timezone** — dates are absolute calendar dates computed device-local; DST/travel is cosmetic, not data corruption.

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-07 | Meal Planning Lead | Initial draft, built to WAVE2-DECISIONS.md |
