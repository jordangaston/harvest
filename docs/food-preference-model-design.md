---
tags: [harvest, prefs], tdd
summary: "One scoped directive over every food attribute; scope drives enforcement; evolve user_food_prefs"
locked: false
---

# Food Preference & Composition Model

## Problem

Users state food intent at several levels: hard exclusions (peanut allergy), directional preferences
(less saturated fat), plate rules (veg with every dinner), and aggregate limits (red meat ≤3×/week,
120g protein/day). Today we model only some, in disconnected ways, plus a per-user numeric weight
vector nobody can set meaningfully. So real guidance gets dropped or flattened into an inert goal.

## Design

One **scoped directive** replaces the taste facets, food-category moderation, and the weight vector:

```
{ dimension, value, scope, direction, strength, target?, unit? }
```

**Scope decides how it is enforced:**

- `recipe` — rank or filter a recipe.
- a meal slot (`dinner`, …) — a plate rule; satisfied by the main, or by adding a side.
- `day` / `week` — a running aggregate the planner budgets.

Evolve the existing `user_food_prefs` table — no new tables (pre-release). Allergens and strict diets
stay separate: they are filters, not preferences.

~~~mermaid
classDiagram
    class Directive {
        Dimension dimension
        string value
        Scope scope
        Direction direction
        Strength strength
        number target
        Unit unit
    }
    class Recipe {
        Categories categories
        Ingredient[] ingredients
        NutrientPanel nutrition
    }
    class Plate {
        Slot slot
    }
    User "1" --> "*" Directive : states
    Plate "1" *-- "1..*" Recipe : main + sides
~~~

**Enums**

- `dimension` — `nutrient | food_category | ingredient | cuisine | dish_type`. `value` is the specific
  one (`saturated_fat`, `red_meat`, `cilantro`).
- `scope` — `recipe | breakfast | lunch | dinner | snack | day | week`.
- `direction` — `more | less`. Like → more, dislike → less. "Never" is not a third value: it is
  `{less, strict}` at recipe scope, or `{less, target: 0}` at an aggregate scope.
- `strength` — `soft` (ranking nudge) | `firm` (strong weight, still possible) | `strict` (filter, or
  require). Only `firm → strict` changes behavior (rank → filter).
- `target` · `unit` — aggregate scopes only. `direction` sets the comparator (`less + target` = at
  most, `more + target` = at least). `unit` = `count` (number of **meals** in the scope bearing the
  value) or a nutrient unit (`grams`, summed over the scope).

## Tables

### `user_food_prefs` — evolve the existing table

| Column | Type | Constraints | Notes |
|---|---|---|---|
| user_id | text | not null, fk → users | household-shared in practice |
| dimension | text | not null | was `facet`; add `nutrient` to the enum |
| value | text | not null | `saturated_fat`, `red_meat`, … |
| scope | text | not null, default `recipe` | see enum |
| direction | text | not null | `more` \| `less`; replaces `sentiment` |
| strength | text | not null | `soft` \| `firm` \| `strict`; replaces the weight vector |
| target | number | null | existing column; aggregate scopes only |
| unit | text | null | `count` \| `grams` \| … |
| reason | text | null | existing |

Unique on `(user_id, dimension, value, scope)`.

### Other changes

- **`recipes`** — no schema change. Main vs side is the existing `recipe_categories` **`dish_type`**
  facet (`main_course` / `side_dish` are already in the vocab); breakfast/lunch/dinner/snack is
  `meal_type`. The gap is **data coverage** — the corpus under-tags `side_dish`, so plate completion
  needs enough side recipes (see Q-06). Categories, ingredients, and the USDA nutrient panel exist.
- **Food categories** — add `vegetable` and `fruit` to the `food_category` vocab.
- **`user_preferences`** — drop the weight columns (`weight_cost`, `weight_time`, `weight_nutrition`,
  `weight_difficulty`, `weight_affinity`, `weight_popularity`, `weight_meal_prep`). Keep the rest
  (skill_level, equipment_reviewed, eats_leftovers, household composition).
- **Meal-plan entry** — a plate is `1..*` recipes (main + sides), not one per slot.

## Fact types

The chef never writes `user_food_prefs` directly — it calls `update_facts` → `writeFact` → a
`FactType`, which grounds a loose phrase to a canonical value and validates before persisting. The
table changes above need matching fact-type work, or the agent has nowhere to ground "less saturated
fat" and keeps dropping it (the original bug).

- **Grounding catalogs, per `dimension`:**
  - **`nutrient`** — new `catalog` fact type: legal nutrients + grounding ("saturated fat" → the
    canonical nutrient), backed by the USDA nutrient reference. Same source supplies the `strict`
    thresholds (Q-01).
  - **`food_category`** — add `vegetable` and `fruit` to its catalog.
  - `ingredient` / `cuisine` / `dish_type` — already grounded today (the food-pref facets); reuse as-is.
- **`scope` / `strength` / `direction`** — fixed `enum` values; trivial validation, no catalog.
- **Persisting a directive is composite** — only `value` is catalog-grounded; `direction`, `strength`,
  `scope`, `target`, `unit` ride alongside. Today's `update_facts` carries one grounded value per key,
  which doesn't fit. **Open choice:** widen `update_facts` to a composite value, or add a dedicated
  `set_directive` tool (recommended — it grounds `value` via the dimension's catalog, then writes the
  row with the modifiers).

## How scope enforces it

~~~mermaid
sequenceDiagram
    participant P as Planner
    participant D as Directives
    participant R as Ranker
    participant Cor as Corpus

    P->>D: load household directives
    loop each meal slot in the week
        rect rgb(240,248,255)
        note over P,R: recipe scope - rank and filter mains
        P->>R: rank mains, skewed by open day/week budgets
        R-->>P: pick a main (strict filters, soft/firm weight)
        end
        rect rgb(255,248,240)
        note over P,Cor: meal-slot scope - complete the plate
        alt main covers the slot rule
            note over P: plate is main only
        else missing a component like vegetable
            P->>Cor: find a side matching the directive
            Cor-->>P: side recipe, e.g. broccoli
            note over P: plate is main plus side
        end
        end
        note over P: update running day and week totals
    end
    note over P,D: day/week scope - check aggregates meet targets, adjust best-effort
~~~

## Key decisions

- **One directive, evolved from `user_food_prefs`.** Preference vs composition rule is just `scope`.
- **Strength, not numbers.** A human or agent can say "a bit / really / never," not "3."
- **Retire the weight vector.** Cost, time, difficulty, and nutrition are recipe attributes — a
  directive says "I care about time" as `{cook_time, less, firm, recipe}`.
- **Retire `sentiment`.** `direction` + `strength` subsume like/dislike; `direction` stays two values.
- **Allergens and strict diets stay separate filters** — a filter is not a preference.
- **Base ranking = affinity (recipes like the ones you already like) + popularity.** Directives shape
  that; they are not the base.
- **Plate = main + optional sides**; a rule is met by the main or a side, never by rejecting a good
  main. Main/side reuse the existing `dish_type` facet (`main_course`/`side_dish`) — no new tag.
  `vegetable`/`fruit` are food categories.

## Open questions

| ID | Question |
|---|---|
| Q-01 | A `strict` nutrient directive needs a cutoff (g or %DV per serving/scope). The `nutrient` catalog is the source; still to define: the actual per-nutrient threshold values. |
| Q-05 | Migration: map existing rows (`facet/value/sentiment/target` → `dimension/value/direction/strength`, `scope=recipe`); drop the weight columns. |
| Q-06 | `side_dish` corpus coverage — is there enough in the existing corpus for plate completion, or do we seed/backfill `dish_type=side_dish` recipes? |

Out of scope: how the planner reconciles an already-blown day/week aggregate is meal-plan generation,
not the preference model.

## WI-4 build note (plate + composition)

`completePlate` / `checkAggregate` land as pure modules in `server/src/ranking/` (`plate.ts`,
`aggregate.ts`), over the same `RankableRecipe` the ranker consumes; `recipeMatches` is shared via
`directive-match.ts`. **No schema change:** `meal_plan_entries` already holds `1..*` recipes per slot
ordered by `position`, so a plate is a grouping the composer returns (main-first), not a new table or
column — the design's "meal-plan entry is a plate" is a read/write grouping, satisfied today.

There is **no meal-plan generation/planner path** in the codebase yet (meal-plan is manual
add/remove/list); the composer/aggregate functions are the building blocks it will call. Wiring them
into an end-to-end weekly generator is meal-plan generation — out of scope, as flagged.

**Q-06 still open (data):** `dish_type=side_dish` corpus coverage is unmeasured here — the WI-4 tests
supply their own side, so no test proves the gap blocks completion. Before the planner ships, confirm
the live corpus carries enough `side_dish` recipes (esp. vegetable/fiber sides) or seed/backfill them;
`completePlate` no-ops a rule when no matching side exists, so a thin corpus silently under-completes.
