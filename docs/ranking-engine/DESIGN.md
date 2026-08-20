---
tags: [ranking-engine], tdd
summary: "Recipe ranking engine — algorithm and user-preference data model"
locked: false
---

# Ranking Engine — Design

## Context

Harvest recommends recipes. Every recipe now carries the signals a ranker needs — cost,
difficulty, nutrition, affinity, allergens, diet, and time — persisted by earlier sprints. An
eighth signal, popularity, is not built yet and must slot in later without a rewrite.

This document specifies two things:

- **(A) The ranking algorithm** — how the eight signals collapse into one per-user score, which
  signals gate the candidate pool as hard filters, and how per-user weights modulate the rest.
- **(B) The user-preference data model** — the per-user tables that store the targets, weights,
  and severities the algorithm reads.

The first version is deliberately boring: a **filter-then-rank** pipeline where hard constraints
shrink the candidate pool, then a **weighted average of normalized signal scores** ranks what
survives. Weights are explicit stored integers, not learned coefficients. This is the baseline the
research calls the "0-to-1" model (§ Research); richer schemes (learned weights, implicit-feedback
decay) are recorded in [Open Questions / Future](#open-questions--future), not built.

Design goals, in order:

1. A reader can implement the algorithm and the schema from this document with no further decisions.
2. Every one of the eight signals is accounted for; every stored attribute traces to a signal.
3. Design choices are justified against the research, not asserted.

---

## Research summary

Step 1 was a fan-out study of how consumer recommendation apps store preference data and feed it to
ranking. Full findings and citations in [References](#references); the load-bearing conclusions:

- **Filter-then-rank is universal.** Hard constraints (restrictions, allergens, prohibitions) build
  the feasible candidate pool *before* any scoring; learned soft preferences re-rank *within* it.
  Yum-me applies a nutrition/restriction filter, then projects a learned taste profile onto the
  survivors [S1]. A TV patent blocks prohibited content entirely while all other preferences are
  weighted adjustments on a base score [S2]. → **We adopt filter-then-rank.**
- **Soft signals combine as a weighted sum of interpretable per-feature scores.** FaRM stores a
  per-user feature-weight vector `λ^(u) ∈ R^F` and scores as `Σ λ_f · φ_f`, a weighted sum with no
  hard-filter term [S4]. → **We adopt a weighted average of normalized per-signal scores.**
- **Weights are learned in production systems, but the boring first version stores them explicitly.**
  Whatnot fits latent factors with BPR/WARP, and flags it as their *initial* 0-to-1 model with
  deep-learning successors as future work [S3]. A music patent *derives* default weights from a
  user's behavioral distribution but lets explicit sliders override them [S5]. → **We store explicit
  weights now; learning is Future.**
- **Severity/strictness is a first-class quantity, kept separate from the preference itself.** The
  canonical implicit-feedback formulation stores a binary preference distinct from a scalar
  confidence `c = 1 + α·r` [S6]. Meal-planning guidance separates dietary needs into
  non-negotiable medical restrictions, ethical/religious choices, and personal preferences [S8]. An
  allergen app flags each allergen as *certainly* vs *potentially* present [S9]. → **We model
  allergen severity and diet strictness as explicit enum fields that decide filter-vs-soft.**
- **Stated preferences become numeric weights at write time.** A patent translates a stated
  distribution directly into per-criterion weights (40% → weight 4) [S5]. → **Onboarding importance
  answers map to integer weights when we persist them.**

Honest caveat from the research: no source published a concrete allergen-*severity* or
dietary-*strictness* enum as a stored field. The closest patterns are the preference/confidence
split [S6] and the medical/ethical/preference tiering [S8][S9]. Our severity and strictness enums
are a synthesis of those patterns, not a copied production schema. See [Q-01](#open-questions--future).

---

# Use Case Implementations

## Rank Recipes For User — Implements F-01

The one flow: given a user, return their recipe catalog ordered best-first. Hard filters drop unsafe
or incompatible recipes; the survivors are scored and sorted.

~~~mermaid
sequenceDiagram
    participant C as Client
    participant API as RankController
    participant R as RecipeRepository
    participant P as PreferenceRepository
    participant E as RankingEngine
    participant F as FilterRule[]
    participant S as SignalScorer[]

    C->>API: GET /v1/recipes/ranked?page_token=…
    API->>P: getPreferences(userId)
    P-->>API: UserPreferences (weights, targets, allergens, diets, food prefs)
    API->>R: listRecipesWithSignals(userId, page_token)
    R-->>API: Recipe[] (+ categories, allergens, diet verdicts)
    API->>E: rank(recipes, preferences)

    rect rgb(255, 248, 240)
    note over E,F: Hard filter — build candidate pool (O-01)
    loop each recipe
    E->>F: excludes(recipe, preferences)?
    F-->>E: true → drop / false → keep
    end
    end

    rect rgb(240, 248, 255)
    note over E,S: Score survivors (O-02)
    loop each surviving recipe
    E->>S: score(recipe, preferences) per signal → (value, available)
    S-->>E: normalized s_i ∈ [0,1] or null
    note over E: score = Σ wᵢ·sᵢ / Σ wᵢ over available signals
    end
    end

    E->>E: sort by score desc, then tie-breakers
    E-->>API: RankedRecipe[] (recipe, score, per-signal breakdown)
    API-->>C: 200 { recipes, page_token }
~~~

## Filter Candidate Pool — Implements O-01

A recipe is excluded if **any** registered `FilterRule` excludes it. Two rules ship:

- **AllergenFilter** — for each of the user's allergens, gated by its `severity`:

  | Severity | Excludes when the recipe… |
  | --- | --- |
  | `severe` (anaphylaxis) | `contains` **or** `may_contain` the allergen, **or** `allergens_complete = false` (unknown ⇒ unsafe) |
  | `moderate` (intolerance) | `contains` the allergen |
  | `mild` (avoidance) | *never excludes* — applies a soft penalty instead (§ Soft penalties) |

  This makes severity the field that decides filter-vs-soft, per [S6][S8][S9] and resolving the
  research's open "when does a soft down-weight become a hard exclusion?" question.

- **DietFilter** — for each diet the user follows, gated by its `strictness`:

  | Strictness | Excludes when the recipe's verdict for that diet is… |
  | --- | --- |
  | `strict` | `incompatible` (an `unknown` verdict is **kept** but takes the soft penalty — graceful degradation when diet coverage is incomplete) |
  | `flexible` | *never excludes* — `incompatible`/`unknown` take a soft penalty instead |

## Score Survivor — Implements O-02

For one recipe, each `SignalScorer` returns a normalized score `sᵢ ∈ [0,1]` (1 = ideal for this
user) or `null` when the recipe lacks that signal's data. The engine folds the registry:

```
score(user, recipe) = Σ_{i ∈ A} wᵢ · sᵢ   /   Σ_{i ∈ A} wᵢ
    where A = { signals with sᵢ ≠ null and wᵢ > 0 }
```

A **weighted average over available signals** — not a weighted sum — so a recipe with a missing
signal (null cost, null NRF) is neither rewarded nor punished for the gap; the signal simply drops
out of both numerator and denominator. If `A` is empty (no signals available) the score is `0` and
the recipe sorts last. The result is in `[0,1]`; multiply by 100 for display.

Soft penalties (mild allergen, flexible-diet miss) subtract a fixed constant from the final score
after the average, floored at 0. See [Soft penalties](#soft-penalties).

---

# Ranking Algorithm

This section is the implementable core: the eight signals, each signal's normalization, how weights
modulate them, tie-breaking, cold-start, and a worked example.

## Signal roster

| # | Signal | Role | Recipe source column(s) | Per-user weight | Per-user target |
| --- | --- | --- | --- | --- | --- |
| 1 | Cost | soft | `cost_per_serving_cents` | `weight_cost` | `budget_cents_per_serving` |
| 2 | Difficulty | soft | `difficulty_band` | `weight_difficulty` | `skill_level` |
| 3 | Nutrition | soft | `nrf_score` | `weight_nutrition` | — (weight only) |
| 4 | Affinity | soft | `recipe_categories` | `weight_affinity` | `user_food_prefs` |
| 5 | Allergens | **hard filter** | `allergens`, `allergens_complete` | — | `user_allergens` (severity) |
| 6 | Diet | **hard filter** (strict) / soft penalty (flexible) | `recipe_diets.verdict` | — | `user_diets` (strictness) |
| 7 | Time | soft | `total_minutes` | `weight_time` | `time_budget_minutes` |
| 8 | Popularity | soft, **not built** | *(future column)* | `weight_popularity` | — (weight only) |

Six soft signals carry a weight. Allergens and diet are filters (allergens always; diet when
strict), so they carry **no weight** — this is the "allergens are a hard filter, not a score"
requirement, extended to strict diets. Nutrition and popularity have a weight but no target: the
recipe value alone defines the score, and the weight alone sets importance (§ flagged below).

## Per-signal normalization

Each scorer maps recipe data to `sᵢ ∈ [0,1]`. Reference constants live in a config module
(`ranking/constants.ts`), not per user, and are tuning knobs — calibrate against the real catalog.

**1 — Cost.** At or under budget is ideal; the score ramps to 0 as cost rises to twice the budget.

```
s_cost = clamp( (2·budget − cost) / budget , 0, 1 )
```

`budget = budget_cents_per_serving`, `cost = cost_per_serving_cents`. Null cost or null budget →
`null` (unavailable).

**2 — Difficulty.** Compare the recipe's band (beginner=1, intermediate=2, advanced=3) to the
user's `skill_level` (same scale). Cooking above your skill hurts more than cooking below it, so the
match is an asymmetric lookup on signed distance `d = recipe_level − skill_level`:

| d | −2 (much easier) | −1 (easier) | 0 (match) | +1 (a stretch) | +2 (over their head) |
| --- | --- | --- | --- | --- | --- |
| `s_diff` | 0.70 | 0.85 | 1.00 | 0.60 | 0.20 |

Null band → `null`. (A 3×3 lookup is chosen over a contrived formula for readability.)

**3 — Nutrition.** A *saturating squash* of the raw NRF 15/3 score — deliberately **not** min-max.
NRF is a per-100-kcal density with a long right tail: the NRF 15/3 whole-diet population mean is ≈ 57
and individual nutrient-dense foods reach the low hundreds [S11]. A linear min-max would either clamp
that tail flat (collapsing distinct healthy recipes to an identical 1.0, killing the signal exactly
where it should discriminate) or compress everyday recipes into a sliver. The squash is bounded,
order-preserving all the way up, and never maps two distinct scores to the same value:

```
s_nutr = x⁺ / (x⁺ + k)      where  x⁺ = max(0, nrf),  k = 57
```

`k` is the NRF value that scores 0.5 — set to the NRF 15/3 whole-diet mean (57) as a literature
stopgap [S11], recalibrated to the real catalog median once recipes exist (then just re-rank). `x⁺`
floors junk-food negatives at 0. The curve rises fast for low scores and flattens toward 1 for very
nutritious recipes (diminishing returns), approaching but never reaching 1 — so nutrition can always
break a tie between two healthy dishes. Null `nrf_score` → `null`.
**Flag:** nutrition has no per-user *target* attribute — "how nutritious they want meals" is
expressed entirely through `weight_nutrition`. A user who does not care sets the weight low.

**4 — Affinity.** For each affinity facet present on the recipe (cuisine, dish_type,
primary_ingredient), score the user's sentiment toward the recipe's values in that facet:
`a_f = +1` if the recipe shares any *liked* value, `−1` if it shares a *disliked* value and no liked
one, else `0`. Average across the facets the recipe has, then center on a neutral 0.5:

```
s_aff = clamp( 0.5 + 0.5 · mean(a_f) , 0, 1 )
```

All-liked → 1.0, all-neutral → 0.5, all-disliked → 0.0. The 0.5 neutral baseline means an
unfamiliar recipe is treated as average, not penalized. No categories at all → `null`.

**5 — Allergens.** Hard filter (O-01). Not scored. `mild`-severity allergens apply a soft penalty.

**6 — Diet.** Hard filter when strict (O-01). `flexible` diets and `strict` `unknown` verdicts apply
a soft penalty. Not otherwise scored.

**7 — Time.** Mirrors cost: at or under the time budget is ideal, ramping to 0 at twice the budget.

```
s_time = clamp( (2·T_budget − total_minutes) / T_budget , 0, 1 )
```

Null `total_minutes` or null budget → `null`. (Parallel to cost by design — one mental model.)

**8 — Popularity.** Not built. The scorer is registered but returns `null` until a normalized
`popularity` column exists, at which point `s_pop = popularity` (already 0–1) with no other change.
Adding it is: one column + one `PopularityScorer` in the registry + the existing
`weight_popularity`. No formula, filter, or schema-shape change. This is the pluggable-signal
requirement (§ Modules).

## Weights

`wᵢ` is a small integer in `[0, 3]` per soft signal, stored per user. It answers "how much does this
matter to you," not "what do you want" (that is the target). A weight of 0 removes the signal
entirely. Defaults come from onboarding (§ Cold start).

**Where a stated preference becomes a number:** onboarding asks importance on a 4-point scale; the
preference repository maps it to the integer weight at write time:

```
none → 0    somewhat → 1    important → 2    very important → 3
```

This is the research's "translate the stated answer into a weight" step [S5], done once, at persist
time, so the ranker only ever reads integers.

## Soft penalties

Applied to the final averaged score, after the weighted average, floored at 0. Fixed constants
(config, tunable):

| Trigger | Penalty |
| --- | --- |
| Recipe `contains` a `mild`-severity allergen | −0.15 |
| `flexible` diet, verdict `incompatible` | −0.20 |
| `flexible` diet, verdict `unknown`, **or** `strict` diet, verdict `unknown` | −0.05 |

Penalties are additive and stack. They express "avoid, don't forbid" — the soft end of the
severity/strictness spectrum [S6][S8].

## Tie-breaking

Equal scores break deterministically, in order:

1. **Higher signal coverage** — count of available signals (`|A|`); more data ⇒ more confidence.
2. **Higher popularity** — once the column exists; until then a no-op.
3. **Newer recipe** — `created_at` descending.
4. **Recipe id** — ascending; a stable final tiebreaker so paging is deterministic.

## Cold start

A new user with no `user_preferences` row is ranked with a **default weight profile** derived from
the onboarding `goals` already stored on `users`:

| Onboarding goal (existing `users.goals`) | Weight bump |
| --- | --- |
| `save_money` | `weight_cost` → 3 |
| `eat_healthier` | `weight_nutrition` → 3 |

Every other weight defaults to **1** (uniform baseline). Only these two of the seven current onboarding
goals (`eat_healthier`, `save_money`, `improve_cooking`, `organize_recipes`, `plan_meals`,
`meal_prepping`, `try_new_cuisines`) map cleanly onto a ranking weight; the rest leave weights at the
uniform default. If a "spend less time cooking" goal is added later, map it to `weight_time`. This mirrors the patent pattern of deriving
default weights from stated goals [S5]. With no goals and no preferences at all: all weights = 1, no
hard filters (no known allergens or diets), affinity neutral at 0.5 everywhere. Ranking is then
driven by nutrition, cost, and time against catalog-reference bounds — a sensible, safe default that
improves as the user fills in preferences. Targets that are null (no budget, no time budget) simply
make their signal unavailable rather than forcing a guess.

## Worked example

**User "Alice"** — `skill_level = intermediate`, `budget = 400¢`, `time_budget = 30 min`; weights
`{cost:3, difficulty:1, nutrition:3, affinity:2, time:2, popularity:0}`; allergen `peanut: severe`;
no diets; food prefs like `cuisine:italian`, like `primary_ingredient:chicken`, dislike
`primary_ingredient:liver`. Constant: `k = 57` (nutrition squash).

| Recipe | cost¢ | band | NRF | categories | min | allergens |
| --- | --- | --- | --- | --- | --- | --- |
| R1 Chicken Piccata | 350 | intermediate | 45 | cuisine:italian, dish:pan-fry, primary:chicken | 25 | none |
| R2 Pad Thai | 500 | advanced | 30 | cuisine:thai, primary:shrimp | 40 | contains peanut |
| R3 Veggie Minestrone | 250 | beginner | 70 | cuisine:italian, dish:soup, primary:beans | 45 | none |

**Filter (O-01):** R2 `contains peanut`, and Alice's peanut severity is `severe` → **R2 excluded.**
R1, R3 survive.

**Score R1:**

| Signal | Computation | sᵢ | wᵢ |
| --- | --- | --- | --- |
| cost | clamp((800−350)/400) = clamp(1.125) | 1.00 | 3 |
| difficulty | d = 2−2 = 0 → match | 1.00 | 1 |
| nutrition | 45 / (45+57) = 45/102 | 0.441 | 3 |
| affinity | facets: italian(+1), pan-fry(0), chicken(+1); mean = 0.667; 0.5+0.5·0.667 | 0.833 | 2 |
| time | clamp((60−25)/30) = clamp(1.167) | 1.00 | 2 |

`Σw = 11`. `Σw·s = 3(1.0) + 1(1.0) + 3(0.441) + 2(0.833) + 2(1.0) = 8.990`.
**score = 8.990 / 11 = 0.817 → 81.7**

**Score R3:**

| Signal | Computation | sᵢ | wᵢ |
| --- | --- | --- | --- |
| cost | clamp((800−250)/400) = clamp(1.375) | 1.00 | 3 |
| difficulty | d = 1−2 = −1 (easier) → 0.85 | 0.85 | 1 |
| nutrition | 70 / (70+57) = 70/127 | 0.551 | 3 |
| affinity | italian(+1), soup(0), beans(0); mean = 0.333; 0.5+0.5·0.333 | 0.667 | 2 |
| time | clamp((60−45)/30) = clamp(0.50) | 0.50 | 2 |

`Σw = 11`. `Σw·s = 3(1.0) + 1(0.85) + 3(0.551) + 2(0.667) + 2(0.50) = 7.837`.
**score = 7.837 / 11 = 0.712 → 71.2**

**Result:** R1 (81.7) > R3 (71.2); R2 filtered. Chicken Piccata wins — Italian and chicken are both
liked, it is fast and matches Alice's skill. Minestrone is the more nutritious dish but loses on
affinity, time, and a slight "too easy" difficulty discount. The ranking matches intuition, which is
the point of the boring model.

---

# Entities

~~~mermaid
classDiagram
    class UserPreferences {
        +SkillLevel skillLevel
        +int budgetCentsPerServing
        +int timeBudgetMinutes
        +Weights weights
    }
    class Weights {
        +int cost
        +int difficulty
        +int nutrition
        +int affinity
        +int time
        +int popularity
    }
    class AllergenPreference {
        +Allergen allergen
        +AllergenSeverity severity
    }
    class DietPreference {
        +string dietId
        +DietStrictness strictness
    }
    class FoodPreference {
        +Facet facet
        +string value
        +Sentiment sentiment
    }
    class Recipe {
        +int costPerServingCents
        +DifficultyBand difficultyBand
        +number nrfScore
        +int totalMinutes
        +RecipeAllergens allergens
        +RecipeCategories categories
        +Map~string,Verdict~ dietFit
    }
    class RankedRecipe {
        +Recipe recipe
        +number score
        +Map~string,number~ breakdown
    }

    UserPreferences "1" *-- "1" Weights : embeds
    UserPreferences "1" --> "*" AllergenPreference : declares
    UserPreferences "1" --> "*" DietPreference : follows
    UserPreferences "1" --> "*" FoodPreference : likes/dislikes
    RankedRecipe "1" --> "1" Recipe : wraps
~~~

`Recipe` and its `RecipeAllergens` / `RecipeCategories` / `dietFit` already exist (see
`server/src/models/recipe.ts`, `allergen/allergen.ts`, `diet/diet.ts`). Only the `UserPreferences`
cluster and `RankedRecipe` are new.

---

# Tables

All tables follow repo conventions (`server/src/schema.ts`): `text` UUID keys, `integer`
timestamps in epoch mode, enums as `text('col', { enum: [...] })`, numeric-as-text where precision
matters. Weights are small integers, stored as `integer` (no precision concern).

## user_preferences

One row per user (1:1). Holds the scalar targets and the six soft-signal weights.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| user_id | text | pk, fk → users.id, on delete cascade | |
| skill_level | text (enum) | not null, default `beginner` | `beginner`/`intermediate`/`advanced`; feeds difficulty |
| budget_cents_per_serving | integer | null | soft target for cost; null ⇒ cost signal unavailable |
| time_budget_minutes | integer | null | soft target for time; null ⇒ time signal unavailable |
| weight_cost | integer | not null, default 1 | 0–3 |
| weight_difficulty | integer | not null, default 1 | 0–3 |
| weight_nutrition | integer | not null, default 1 | 0–3; **also** the "how nutritious" preference (no separate target) |
| weight_affinity | integer | not null, default 1 | 0–3 |
| weight_time | integer | not null, default 1 | 0–3 |
| weight_popularity | integer | not null, default 0 | 0–3; **0 until the popularity signal ships** |
| updated_at | integer (timestamp) | not null | |

## user_allergens

Zero or more per user. Severity is first-class and decides filter strictness (O-01).

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| user_id | text | fk → users.id, on delete cascade | |
| allergen | text (enum) | not null | the 9 majors, matching `Allergen` in `allergen/allergen.ts` |
| severity | text (enum) | not null | `severe`/`moderate`/`mild` |

Primary key `(user_id, allergen)`.

## user_diets

Zero or more per user (usually 0–1). Strictness decides filter-vs-penalty (O-01).

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| user_id | text | fk → users.id, on delete cascade | |
| diet_id | text | not null | free-text key matching `recipe_diets.diet_id` (e.g. `vegan`, `keto`) |
| strictness | text (enum) | not null | `strict`/`flexible` |

Primary key `(user_id, diet_id)`.

## user_food_prefs

Zero or more per user. Mirrors `recipe_categories` exactly so affinity is a direct join.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| user_id | text | fk → users.id, on delete cascade | |
| facet | text (enum) | not null | `cuisine`/`dish_type`/`primary_ingredient` |
| value | text | not null | same controlled vocabulary as `recipe_categories.value` |
| sentiment | text (enum) | not null | `like`/`dislike` |

Primary key `(user_id, facet, value)`.

## Indices

| Index | Table | Columns | Unique | Purpose |
| --- | --- | --- | --- | --- |
| user_allergens_pk | user_allergens | (user_id, allergen) | yes | lookup a user's allergens |
| user_diets_pk | user_diets | (user_id, diet_id) | yes | lookup a user's diets |
| user_food_prefs_pk | user_food_prefs | (user_id, facet, value) | yes | join against recipe_categories |

No new index on the recipe side: ranking loads a user's own recipes (already filtered by
`user_id`), which the existing keyset index serves.

## Drizzle sketch

```ts
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  skillLevel: text('skill_level', { enum: SKILL_LEVELS }).notNull().default('beginner'),
  budgetCentsPerServing: integer('budget_cents_per_serving'),
  timeBudgetMinutes: integer('time_budget_minutes'),
  weightCost: integer('weight_cost').notNull().default(1),
  weightDifficulty: integer('weight_difficulty').notNull().default(1),
  weightNutrition: integer('weight_nutrition').notNull().default(1),
  weightAffinity: integer('weight_affinity').notNull().default(1),
  weightTime: integer('weight_time').notNull().default(1),
  weightPopularity: integer('weight_popularity').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const userAllergens = sqliteTable('user_allergens', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  allergen: text('allergen', { enum: MAJOR_ALLERGENS }).notNull(),
  severity: text('severity', { enum: ALLERGEN_SEVERITIES }).notNull(), // severe | moderate | mild
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.allergen] }) }))

export const userDiets = sqliteTable('user_diets', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  dietId: text('diet_id').notNull(),
  strictness: text('strictness', { enum: DIET_STRICTNESS }).notNull(), // strict | flexible
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.dietId] }) }))

export const userFoodPrefs = sqliteTable('user_food_prefs', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  facet: text('facet', { enum: AFFINITY_FACETS }).notNull(),
  value: text('value').notNull(),
  sentiment: text('sentiment', { enum: SENTIMENTS }).notNull(), // like | dislike
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.facet, t.value] }) }))
```

## Zod domain model

The repository `parse`s rows into a single `UserPreferences` model at the boundary (repo convention),
folding the child tables in:

```ts
export const UserPreferencesSchema = z.object({
  userId: z.string(),
  skillLevel: z.enum(SKILL_LEVELS),
  budgetCentsPerServing: z.number().int().positive().nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  weights: z.object({
    cost: z.number().int().min(0).max(3),
    difficulty: z.number().int().min(0).max(3),
    nutrition: z.number().int().min(0).max(3),
    affinity: z.number().int().min(0).max(3),
    time: z.number().int().min(0).max(3),
    popularity: z.number().int().min(0).max(3),
  }),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ dietId: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  foodPrefs: z.array(z.object({ facet: z.enum(AFFINITY_FACETS), value: z.string(), sentiment: z.enum(SENTIMENTS) })),
})
```

---

# Traceability

Every stored attribute traces to a signal, and every signal traces back to its backing attributes.

## Attribute → signal

| Stored attribute | Feeds signal | As |
| --- | --- | --- |
| `user_preferences.skill_level` | Difficulty | target (band comparison) |
| `user_preferences.budget_cents_per_serving` | Cost | target (curve center) |
| `user_preferences.time_budget_minutes` | Time | target (curve center) |
| `user_preferences.weight_nutrition` | Nutrition | weight **and** the "how nutritious" preference (no target) |
| `user_preferences.weight_{cost,difficulty,affinity,time,popularity}` | resp. signal | weight |
| `user_allergens.{allergen,severity}` | Allergens | filter gate + `mild` soft penalty |
| `user_diets.{diet_id,strictness}` | Diet | filter gate (strict) + soft penalty (flexible) |
| `user_food_prefs.{facet,value,sentiment}` | Affinity | liked/disliked values |

## Signal → backing attribute

| Signal | Backing preference | Orphan? |
| --- | --- | --- |
| Cost | `weight_cost` + `budget_cents_per_serving` | no |
| Difficulty | `weight_difficulty` + `skill_level` | no |
| Nutrition | `weight_nutrition` (weight-only) | no |
| Affinity | `weight_affinity` + `user_food_prefs` | no |
| Allergens | `user_allergens` (filter) | no |
| Diet | `user_diets` (filter) | no |
| Time | `weight_time` + `time_budget_minutes` | no |
| Popularity | `weight_popularity` (weight-only) | **weight exists, signal not built** — see Future |

No signal is orphaned. Two signals (nutrition, popularity) are weight-only by design — they need no
"what do you want" target because higher is universally better; the weight alone tunes their pull.

---

# Modules

Two small registries make the algorithm pluggable: filters and scorers. Adding popularity touches
only the scorer registry.

~~~mermaid
classDiagram
    class RankingEngine {
        +rank(Recipe[], UserPreferences) RankedRecipe[]
    }
    class FilterRule {
        <<interface>>
        +excludes(Recipe, UserPreferences) boolean
    }
    class SignalScorer {
        <<interface>>
        +key string
        +weight(UserPreferences) int
        +score(Recipe, UserPreferences) number
    }
    class AllergenFilter
    class DietFilter
    class CostScorer
    class DifficultyScorer
    class NutritionScorer
    class AffinityScorer
    class TimeScorer
    class PopularityScorer

    FilterRule <|.. AllergenFilter
    FilterRule <|.. DietFilter
    SignalScorer <|.. CostScorer
    SignalScorer <|.. DifficultyScorer
    SignalScorer <|.. NutritionScorer
    SignalScorer <|.. AffinityScorer
    SignalScorer <|.. TimeScorer
    SignalScorer <|.. PopularityScorer
    RankingEngine --> FilterRule : applies all
    RankingEngine --> SignalScorer : folds all
~~~

`score()` returns `number | null` (null = unavailable). `PopularityScorer.score` returns `null`
until the column exists — it is registered from day one so the fold already accounts for it.

~~~mermaid
flowchart LR
    P[PreferenceRepository] -->|UserPreferences| E[RankingEngine]
    R[RecipeRepository] -->|Recipe with signals| E
    E -->|Recipe, UserPreferences| F[FilterRule array]
    F -->|survivors| E
    E -->|Recipe, UserPreferences| S[SignalScorer array]
    S -->|s_i or null| E
    E -->|RankedRecipe array| API[RankController]
~~~

`RankingEngine` is pure (no I/O): repositories load data, the engine filters/scores/sorts in memory.
This keeps it trivially unit-testable and matches the repo's "hand-wire dependencies, classes with a
`static create()`" convention.

---

# APIs

## Ranked Recipes `GET /v1/recipes/ranked`

Returns the caller's recipes ordered best-first for their preferences. Cursor-paginated with
`page_token` per repo convention.

### Request

- Headers
    - authorization: `Bearer <jwt>`
- Query
    - page_token: string (optional)

### Success Response `200`

- Body
    - recipes: array of object
        - recipe: Recipe
        - score: number (0–100)
        - breakdown: object (signal key → contributed `sᵢ`, for debugging/UI "why")
    - page_token: string | null

### Unauthorized Response `401`

- Body
    - error: object
        - code: int
        - message: string

Scoring runs on the caller's own catalog, so no cross-user authorization beyond the JWT is needed.
Ranking is computed per request over the page (catalogs are small — hundreds of recipes); no
precomputed rank table in v1. See [Q-02](#open-questions--future) if catalogs grow.

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration |
| --- | --- | --- | --- |
| F-01 Rank Recipes For User | Flow | | x |
| O-01 Filter Candidate Pool | Op | x | |
| O-02 Score Survivor | Op | x | |
| Each SignalScorer normalization | — | x | |

## Test Approach

### Unit tests

The `RankingEngine` and every scorer/filter are pure functions over in-memory fixtures — no
database, no network (repo rule: tests never hit the network). Cover:

- **Each scorer's normalization** — boundary inputs (at budget, 2× budget, over; band match/stretch;
  nutrition squash at `x=0 → 0`, `x=k → 0.5`, negative NRF floored to 0, large `x` approaching but
  never reaching 1; all-liked/all-disliked/neutral affinity) and the `null`/unavailable path.
- **O-01 filters** — the full severity × presence matrix for allergens (severe excludes
  `may_contain` and unknown-completeness; moderate excludes only `contains`; mild never excludes) and
  the strictness × verdict matrix for diets.
- **O-02 combination** — the weighted-average denominator drops unavailable signals; empty `A` ⇒ 0;
  soft penalties stack and floor at 0.
- **The worked example** — assert R1 = 81.7, R3 = 71.2, R2 filtered, as a regression lock on the math.
- **Tie-breaking** — two equal-score recipes order by coverage → popularity → created_at → id.
- **Cold start** — goals `save_money`/`eat_healthier`/`save_time` produce the documented default
  weights; no preferences ⇒ all weights 1, no filters, affinity 0.5.

### Integration tests

One test crossing `RankController → repositories → engine` against a local migrated database (repo's
`global-setup.ts` pattern): seed a user, preferences, and a handful of recipes with known signals;
assert the response order and that a filtered recipe is absent. This is the only integration test
needed — the math is exhaustively covered by unit tests.

## Test Infrastructure

A `preferencesFixture(overrides)` factory and a `recipeWithSignals(overrides)` factory keep the many
scorer unit tests terse. No stub servers (the engine is pure).

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
| --- | --- | --- | --- |
| 1 | schema | Create `user_preferences`, `user_allergens`, `user_diets`, `user_food_prefs` | yes — additive only |
| 2 | code | Ship `RankingEngine`, scorers, filters, `GET /v1/recipes/ranked` | yes |

No data migration: the tables are new and empty. Users without a `user_preferences` row fall to the
cold-start path (§ Cold start), so the endpoint is safe the moment it ships, before any onboarding
screen writes preferences.

## Deploy Sequence

Single deploy. The migration is additive and can run before or with the code; old code ignores the
new tables.

## Rollback Plan

Revert the code; leave the tables (empty, additive, harmless). No data loss path exists because the
feature only reads recipe signals and reads/writes the new preference tables.

---

# Monitoring

## Metrics

| Name | Type | Use Case | Description |
| --- | --- | --- | --- |
| ranked_request_count | counter | F-01 | ranked-endpoint calls; confirms the flow is exercised |
| ranked_filtered_ratio | histogram | F-01 | fraction of a user's catalog removed by hard filters; a spike near 1.0 means over-filtering (e.g. a too-strict severity default) |
| ranked_all_signals_null_count | counter | O-02 | recipes scored 0 for lack of any signal; a rise means upstream signal gaps |

## Alerts

| Condition | Threshold | Severity |
| --- | --- | --- |
| `ranked_filtered_ratio` p90 > 0.9 sustained | 15 min | warn |

## Logging

One structured debug field on the ranked endpoint: `filtered_count` per request (low cardinality).
No per-recipe logging in the scoring loop — it is a hot path.

---

# Decisions

## Weighted average of normalized signals, not a learned model

**Framework:** Direct criterion — implementability now vs. accuracy later.

The research shows production systems converge on **learned** weights (BPR/WARP latent factors [S3],
choice-model coefficients [S4]). But every such source describes them as an evolution *from* a
simpler baseline, and Whatnot explicitly labels its learned model the "0-to-1" step [S3]. We have no
interaction data yet (popularity is not even built), so there is nothing to learn from. A weighted
average of interpretable per-signal scores [S4] is implementable today, debuggable (the `breakdown`
field explains every rank), and is the exact substrate a learned model later refines by replacing
hand-set weights with fitted ones.

**Choice:** Weighted average now; learning is [Future](#open-questions--future).

### Alternatives Considered
- **Learned latent factors (BPR/WARP) [S3]:** rejected — no interaction data exists to fit them.
- **Weighted *sum* (not average):** rejected — penalizes recipes with missing signal data, which is
  common early in the catalog's life; the average drops unavailable signals cleanly.

## Severity and strictness decide filter-vs-soft

**Framework:** Direct criterion — safety.

An allergy can be life-threatening or a mild aversion; a diet can be a medical imperative or a
loose preference. Collapsing either into a single boolean either over-filters (hides safe food from
someone with a mild aversion) or under-filters (shows an allergen to someone who could be
hospitalized). The research separates the preference from its strength [S6] and tiers dietary needs
by how negotiable they are [S8][S9]. We make `severity`/`strictness` explicit enum fields that route
the same declared allergen or diet to a hard filter or a soft penalty.

**Choice:** `severity ∈ {severe, moderate, mild}`, `strictness ∈ {strict, flexible}`, each mapping to
the filter/penalty behavior in O-01.

### Alternatives Considered
- **Boolean "avoid" flag:** rejected — cannot express the safety-critical vs. preference distinction.

## Store weights explicitly as integers, not as a derived-only vector

**Framework:** Direct criterion — the music patent's hybrid [S5].

The patent derives default weights from behavior but lets the user override them [S5]. With no
behavior yet, we store explicit integers, seeded from onboarding goals. When learning arrives it can
overwrite these same columns, so the schema does not change — only who writes the number does.

**Choice:** Six `integer` weight columns on `user_preferences`, seeded from `goals`, override-ready.

### Documentation
- [S5] US8874574B2 — derived defaults + explicit override.

---

# Swipe deck & feedback loop

The ranked list is consumed as a **Tinder-style swipe deck**: the user is shown recipe cards one at a
time, best-ranked first, and swipes right (like) or left (dislike). Swipes are captured — both to drive
the deck (don't re-show a card) and as labeled feedback to improve ranking later. This section extends
the algorithm and data model above; it is **v1.1**, layered on the shipped ranking core.

## Candidate source — owned ∪ global (the global half is blocked)

The deck's candidate set is **the user's own recipes plus the app's global recipe corpus**, not just
owned recipes (the v1 ranked endpoint's `listRankable` is owned-only). This is a `CandidateSource`
seam:

- **Owned recipes** — `recipes.user_id = caller`. Small pool; rank-all-per-request is fine (as today).
- **Global recipes** — a shared corpus the user does not own (discovery). The **ownership model is now
  decided**: `recipes.user_id` is nullable, and a `NULL` owner marks a global/app-owned recipe
  (migration 0011). User-scoped reads filter `user_id = caller`, so globals never leak into an owner's
  list; the deck opts in with `user_id = caller OR user_id IS NULL`. What remains before the global
  half of the deck ships: **populating** the corpus (a seeding/ingestion path that writes
  `user_id = NULL` rows, plus moderation), **unioning** globals into `listRankable`, the **retrieval**
  stage below, and the clone-vs-reference question on "like" — see Q-04. Until then the deck runs over
  owned recipes only.

**Scale changes the retrieval story.** The owned pool stays tiny, so ranking it per request is free.
A *global* corpus can be large — which is exactly the industry **retrieval-then-rank** split (Q-02,
[S1]): a cheap **candidate-generation** step narrows the global corpus to a bounded set (v1: recent /
popular / pre-filtered by the user's hard filters, capped at N), and only that set is scored by the
engine. So the engine is unchanged; a `GlobalCandidateSource.retrieve(prefs, limit)` feeds it.

**Popularity finally matters here.** For a stranger's recipe the user has no affinity or history, so
the (not-yet-built) popularity signal is the natural cold-start ranker for global candidates — the
discovery deck is popularity's primary consumer.

## Deck model — batch, not a persisted queue

Modeled on how Tinder actually works: a **pre-assembled batch** the client swipes through, re-ranked on
the *next* fetch — **not** a re-rank on every swipe, and **not** a persisted queue table.

- `GET /v1/recipes/deck?limit=5` returns the top-N unswiped ranked candidates. The client swipes
  through them and **prefetches the next batch when 1–2 cards remain** (no loading stall).
- **No queue table.** The deck is a query: `rank(candidates) minus recently-swiped`, recomputed each
  fetch. It stays fresh as ranking improves and needs no invalidation.
- **Re-rank at the fetch boundary, never mid-deck.** Weight/preference changes from swipes (below) are
  written immediately but only reshape the *next* deck fetch — so the batch under the user's thumb
  never reshuffles. This is Tinder's stability property, and with a 5-card batch the tuning still takes
  effect within a few swipes.
- **Cooldown exclusion.** A recipe swiped within the last `SWIPE_COOLDOWN_DAYS` (config) is excluded
  from candidates. A *pass* ("not tonight") can resurface after the cooldown — unlike dating, a recipe
  you skipped Tuesday may fit Friday. A `like` is excluded permanently (it is in the Liked cookbook); a
  reasoned `dislike` also naturally ranks low after cooldown via the tuning it triggers. The exclusion
  lives in candidate assembly (a set-level filter on `recipe_swipes.created_at`), not in the scorer.

## Table: recipe_swipes

Captures each swipe as labeled feedback, snapshotting the ranking context so the data is usable for
learning later.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| user_id | text | fk → users.id, cascade | |
| recipe_id | text | fk → recipes.id, cascade | |
| direction | text (enum) | not null | `like` / `dislike` / `save` (`save` = "cook this week" → Saved cookbook) |
| reason | text (enum) | null | dislike only: `too_expensive` / `too_hard` / `too_slow` / `disliked_ingredient` / `not_nutritious` / `other` |
| score | real | not null | the recipe's rank score at swipe time |
| weights | text (json) | not null | snapshot of the six weights used to rank it |
| created_at | integer (timestamp) | not null | for cooldown + time-decay learning |

Primary key `(user_id, recipe_id)` — one verdict per recipe; a re-swipe upserts. Index
`(user_id, created_at)` for cooldown and recent-activity queries. `weights` is the truly
non-recoverable context (weights drift over time); `score` is convenient; the per-signal `breakdown`
JSON is an optional richer add (the recipe's normalized features at swipe time).

## Table change: cookbooks.system_slug

Add a nullable `system_slug` (text) to `cookbooks`, unique per `(user_id, system_slug)`, to reliably
identify system-managed collections (`'liked'`, later `'cooked'`/`'saved'`) so they are not
duplicated, renamed, or deleted like user cookbooks. `NULL` = an ordinary user cookbook.

## Endpoints & side-effects

- `GET /v1/recipes/deck?limit=5` — the next batch of unswiped ranked cards (owned-only until the global
  corpus exists). Same card + score + breakdown shape as `/v1/recipes/ranked`.
- `POST /v1/recipes/:id/swipe` `{ direction, reason? }` — upserts a `recipe_swipes` row with the score
  and weights snapshot, then applies the side-effect for its direction:
  - **`like` → Liked cookbook.** Lazily create the user's `system_slug='liked'` cookbook if absent, add
    the recipe (reusing `cookbooks` / `cookbook_recipes`). [For a *global* recipe the user does not own,
    whether "like" references the shared row or clones a copy into the user's library is part of the
    Q-04 global-corpus design.]
  - **`dislike` + `reason` → tune.** The **first write-path into `user_preferences`** (WI-RANK-1's
    repository is read-only). The reason names the signal that should have down-ranked the card:

    | Reason | Effect |
    | --- | --- |
    | `too_expensive` | `weight_cost` +1 (cap 3) |
    | `too_hard` | `weight_difficulty` +1 |
    | `too_slow` | `weight_time` +1 |
    | `not_nutritious` | `weight_nutrition` +1 |
    | `disliked_ingredient` | add a `dislike` to `user_food_prefs` for the ingredient (a *target*, not a weight) |
    | `other` / none | record only |

    Most reasons nudge a *weight* (a signal's importance); `disliked_ingredient` nudges a *target* (a
    specific dislike) — the right distinction. Nudges are coarse (+1 integer, capped 3) and, per the
    deck model, take effect at the next fetch. Coarse immediate tuning is boring-first; the learned
    loop (Future) supersedes it.

## Buildable now vs. blocked

- **Now (over owned recipes):** `recipe_swipes` table, `cookbooks.system_slug`, `GET /v1/recipes/deck`,
  `POST /v1/recipes/:id/swipe` with the Liked-cookbook and reason-tuning side-effects, cooldown
  exclusion. This is a self-contained work item on top of the shipped ranking core.
- **Blocked on the global corpus (Q-04):** the global half of the candidate source and its retrieval
  stage. Design the `CandidateSource` seam now (owned-only implementation), slot global in when the
  corpus exists.

---

# Open Questions / Future

| ID | Question | Status | Resolution |
| --- | --- | --- | --- |
| Q-01 | No researched source published a concrete allergen-severity or diet-strictness enum. Are `{severe,moderate,mild}` / `{strict,flexible}` the right granularity, or do users need finer tiers (e.g. religious vs. ethical vs. medical)? | open | Validate with onboarding UX; enums are cheap to extend. |
| Q-02 | Ranking is computed per request. At what catalog size does this need a precomputed rank table or retrieval/ranking split (the industry pattern [S1])? | open | Revisit if p95 latency degrades; catalogs are per-user and small in v1. |
| Q-03 | When both a hard filter and a soft signal touch the same concept (a user "avoids" but does not "forbid" dairy), is a fixed penalty constant right, or should it scale with severity? | open | Research flagged this as unresolved industry-wide; start with fixed constants, tune from data. |
| Q-04 | Ownership model resolved: `recipes.user_id NULL` = global (migration 0011). Still open: how the corpus gets **populated + moderated** (a NULL-owner ingestion path), and does "liking" a global recipe reference the shared row or **clone** it into the user's library? | partial | Data model shipped. Build the `CandidateSource` seam owned-only now; corpus population + clone-vs-reference are their own work items. |
| Q-05 | Immediate +1 weight nudges on a reasoned dislike can feel unpredictable ("why did everything change?"). Is coarse integer tuning at the fetch boundary enough, or does it need smoothing / a finer scale / a confirmation? | open | Ship coarse + capped + batch-boundary as the guardrail; revisit when the learned loop lands. |
| Q-06 | What is the right `SWIPE_COOLDOWN_DAYS` before a passed recipe can resurface, and should a reasoned dislike be a longer/permanent exclusion than a bare pass? | open | Start with one constant; tune from swipe data (which is now captured). |

**Future (recorded, not built) — the richer ideas the research surfaced, deliberately deferred to
keep v1 boring:**

- **Popularity signal (signal #8).** Ships as: a normalized `popularity` column (0–1, e.g.
  decayed engagement from social-media imports), a `PopularityScorer` returning it, and setting
  `weight_popularity` defaults > 0. No algorithm change — this is why the scorer is already
  registered.
- **Learned weights.** Replace hand-set integer weights with coefficients fit to chosen-vs-skipped
  recipes — a Bradley-Terry / choice-model fit [S4] or matrix-factorization ranking objective
  (BPR/WARP) [S3]. Writes the same weight columns; the ranker is unchanged.
- **Implicit feedback with time-decay.** Learn affinity and weights from behavior (cooked, saved,
  swiped), weighting recent events more via exponential decay `k·e^(−t)` and stronger actions more
  than weak ones [S2][S6]. The interaction-events table now exists — `recipe_swipes`, with its
  per-swipe `score`/`weights` snapshot and `created_at` — so this loop can train on real labels; it
  supersedes the coarse per-swipe nudges (§ Swipe deck).
- **Confidence weighting.** Store a per-preference confidence alongside the preference [S6], so a
  weakly-held like pulls less than a strongly-held one.
- **Relative soft attributes.** Model subjective attributes (a recipe feeling "fancy" or "quick")
  as personalized *relative* statements between recipes rather than absolute per-recipe scores [S10].
- **Hard-exclude ingredients.** Promote a strong `dislike` in `user_food_prefs` to a hard exclusion
  (the exclusion-filter-vs-inclusion-tag distinction [S7]) — deferred; today a dislike is only a soft
  negative in affinity.

---

# References

Step-1 research findings (verified via 3-vote adversarial checking; see the deep-research run).
Source-quality caveat: the strongest data-modeling evidence comes from patents and academic papers,
not from the named consumer apps themselves — patents document that a pattern is *claimed*, not that
any named app ships it.

| Tag | Source | Used for |
| --- | --- | --- |
| S1 | Yum-me, arXiv:1605.07722 | filter-then-rank; restrictions/nutrition as hard constraints separate from learned taste |
| S2 | US9230212B2 (TV recommender) | hard exclusions block entirely; expert weight tables; time-decayed implicit strength |
| S3 | Whatnot Engineering, "Going from 0 to 1" (2022) | learned latent factors (BPR/WARP); explicitly the *initial* model |
| S4 | FaST/FaRM, arXiv:2508.04698 | per-user feature-weight vector `λ^(u)`; interpretable weighted sum |
| S5 | US8874574B2 (music) | stated distribution → per-criterion weights; derived defaults + explicit override |
| S6 | Hu-Koren-Volinsky, US20110153663A1 | preference (binary) vs. confidence (scalar) `c = 1 + α·r`; severity as a separate quantity |
| S7 | useLadle blog | exclusion filter vs. inclusion tag; preference vs. intolerance vs. life-threatening |
| S8 | flavoreer blog | three tiers: medical (non-negotiable) / ethical-religious / personal preference |
| S9 | Healthy Meals app, PMC8891920 | allergen presence as two-level flag (certainly/red vs. potentially/orange) |
| S10 | Balog/Radlinski/Karatzoglou, SIGIR 2021, arXiv:2105.09179 | soft attributes as personalized relative statements |
| S11 | van Lee et al., "Evaluation of a nutrient-rich food index score in the Netherlands," PMC4462757 | NRF 9.3/15.3 per-100-kcal population stats (NRF15.3 mean ≈ 57) → nutrition-squash `k` |

---

# Appendix A — Changelog

| Date | Author | Change |
| --- | --- | --- |
| 2026-08-18 | Jordan Gaston | Initial design — algorithm + preference data model |
| 2026-08-18 | Jordan Gaston | Nutrition normalization → saturating squash `x⁺/(x⁺+k)`, k=57 from NRF 15/3 literature [S11] (was min-max clamp over [−50, 100], which flattened the healthy tail); reworked worked example accordingly |
| 2026-08-18 | Jordan Gaston | Added Swipe deck & feedback loop (v1.1): candidate source (owned ∪ global — global blocked on a corpus that doesn't exist, Q-04), batch deck (no queue table, re-rank at fetch boundary, cooldown exclusion), `recipe_swipes` table (score/weights snapshot), `cookbooks.system_slug`, like→Liked-cookbook, reasoned-dislike→weight/target tuning |
| 2026-08-18 | Jordan Gaston | Global-corpus ownership model shipped: `recipes.user_id` nullable, `NULL` = global recipe (migration 0011). Resolves the data-model half of Q-04; corpus population + deck union + retrieval + clone-vs-reference remain |
