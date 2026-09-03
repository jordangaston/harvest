# WI-4 — Plate model and meal-slot / day / week composition rules

## Background

The design (§ How scope enforces it) makes a plate `main + optional sides` and enforces non-recipe
scopes: a meal-slot directive ("vegetable with every dinner") is met by the main or by adding a
side; day/week directives are running aggregates the planner budgets. Main vs side reuses the
existing `recipe_categories` `dish_type` facet (`main_course`/`side_dish`) — no new tag. Categories,
ingredients, and the USDA nutrient panel already exist.

Depends on: WI-1 (directive columns), WI-3 (recipe-scope ranking, since plate mains are ranked).

## Objective

Build the plate (main + sides) and enforce meal-slot, day, and week directives during plan
composition, completing a plate with a side when the main misses a slot rule.

## Scope

1. **Plate model**: a meal-plan slot holds `1..*` recipes (a main plus optional sides), not one
   recipe. Extend `meal_plan_entries` reads/writes so a slot returns its main + sides (the
   `position` column already orders entries within a slot).
2. **Meal-slot enforcement**: for each planned slot, if the main does not satisfy a slot-scope
   directive (e.g. `{food_category:'vegetable', scope:'dinner', direction:'more'}`), find a
   `dish_type=side_dish` recipe matching the directive and add it as a side.
3. **Day/week aggregation**: maintain running totals per day/week scope (meal counts for
   `unit='count'`, summed grams for a nutrient unit) and check them against each aggregate
   directive's `target`+`direction` comparator (`less+target` = at most, `more+target` = at least).
   Reconciling an already-blown aggregate is out of scope (meal-plan generation, per the design).
4. **`side_dish` coverage note** (design Q-06): confirm the corpus has enough `dish_type=side_dish`
   recipes for plate completion; if thin, note the seed/backfill need — do not seed here unless a
   test proves the gap blocks completion.

## Acceptance Criteria

- **AC-1** A plate returns a main plus zero or more sides; the slot's recipes are ordered by
  `position`.
- **AC-2** A dinner-scope `vegetable`/`more` directive with a main lacking vegetable adds a
  `side_dish` vegetable recipe; a main that already covers it adds no side.
- **AC-3** A day-scope `{nutrient, less, target, unit:'grams'}` directive sums the scope's recipes
  and reports whether the plan meets it; a `count` unit counts meals bearing the value.
- **AC-4** A week-scope `more+target` directive reports met/unmet against the summed total.
- **AC-5** Build clean; suite green except the two media failures.

## Test Cases

### Test Case 1: plate = main + side (AC-1/2)
**Preconditions:** a corpus with a vegetable-free main and a `side_dish` vegetable recipe.
**Steps:** compose a dinner slot under a `vegetable`/`dinner`/`more` directive.
**Expected:** the plate is `[main, vegetable side]`; with a vegetable-carrying main, it is `[main]`.

### Test Case 2: day aggregate (AC-3)
**Steps:** plan a day whose recipes sum to 30g of a nutrient under a `{nutrient, less, target:20,
day, grams}` directive.
**Expected:** the aggregate check reports unmet (30 > 20).

### Test Case 3: week count (AC-4)
**Steps:** a `{food_category:'red_meat', less, target:3, week, count}` directive over a week with 4
red-meat meals.
**Expected:** reported unmet (4 > 3).

## Deployment Strategy

Reads/writes over existing tables (`meal_plan_entries`, `recipe_categories`, `fdc_food_nutrient`).
No schema change unless the plate needs a slot grouping column (evaluate; prefer `position`).

## Production Verification

### Production Verification 1: vegetable-with-dinner rule
**Steps:** a user states "a vegetable with every dinner"; generate a week.
**Expected:** every dinner plate carries a vegetable — from the main or an added side.
