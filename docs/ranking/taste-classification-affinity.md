---
tags: [harvest, ranking], tdd
summary: "Taste classification + affinity overhaul — comprehensive cuisines and all ~5,000 foods as ranking signals"
locked: false
---

# Taste Classification & Affinity Overhaul

The onboarding taste picker lets a user say *what they like to eat* and *what to avoid*. Today those
picks silently fail to reach ranking. This document reworks recipe **classification** and the
**affinity** signal so every cuisine (tex-mex, cajun, baja, creole, …) and every one of the ~5,000
seeded foods (okra, miso, blue cheese, …) actually moves recommendations, and specifies the
serve-once `GET /v1/taste-options` catalog that feeds the picker.

## The gap, stated precisely

A taste pick influences ranking only when it maps to something a recipe carries. Two chokepoints
decide that:

1. **Classification.** `RecipeCategorizer.analyze()` tags each recipe against a 19-cuisine allow-list
   (`server/src/categorize/vocab.ts:8`), and `constrain()` **drops any value not in `VOCAB`**
   (`server/src/categorize/taste-classifier.ts:130`). A recipe is never tagged `tex-mex` — the value
   cannot survive the filter.
2. **Affinity.** `AffinityScorer.facetSentiment()` scores a recipe by intersecting
   `prefs.foodPrefs` `{facet, value}` with `recipe.categories` on three facets — cuisine, dish_type,
   primary_ingredient (`server/src/ranking/scorers.ts:57`). Ingredient-level food likes have **no
   facet to land on**: a recipe carries at most 12 coarse `primary_ingredient` classes
   (`server/src/categorize/vocab.ts:23`), never "okra". An "okra" dislike intersects nothing and
   scores 0.

The client already offers the richer vocabulary the server cannot honor: `ALL_CUISINES` includes
`"Tex-Mex"`, `"Cajun"`, `"Soul food"` (`components/onboarding/primitives.tsx:238`) and
`ALL_INGREDIENTS` includes `"Okra"`, `"Miso"`, `"Kimchi"`
(`components/onboarding/primitives.tsx:239`). These are hardcoded, duplicate the server vocab, and
map to `{cuisine | dish_type | ingredient}` in `tasteFacet()`
(`components/onboarding/primitives.tsx:360`) — but `ingredient` is not an affinity facet the server
scores, and `"Tex-Mex"` is not a cuisine the server recognizes. The picks are accepted by
`PUT /v1/preferences` and stored; they simply never match a recipe.

This overhaul closes both chokepoints and makes the client read the server's vocabulary instead of
carrying its own.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Use Case Implementations

The feature spans three flows: serving the catalog, classifying a recipe against the expanded
vocabulary, and scoring affinity against the new ingredient facet.

## Serve Taste Options — Implements F-TO-1: Load the taste-picker catalog

The picker fetches the full option catalog **once** at app start and caches it. It is not a
per-keystroke search: latency and offline use rule that out, and every option must map to a ranking
value, so free text is not selectable.

~~~mermaid
sequenceDiagram
    participant App as Onboarding/Settings (client)
    participant Q as TanStack Query + AsyncStorage
    participant API as GET /v1/taste-options
    participant Vocab as VOCAB (server code)
    participant Repo as FdcFoodRepository

    App->>Q: useTasteOptions()
    alt cache fresh (< staleTime) or offline
        Q-->>App: cached TasteOptions
    else stale or cold
        Q->>API: GET /v1/taste-options
        API->>Vocab: cuisines, dishTypes
        API->>Repo: tasteFoods()  (curated ingredient list)
        Repo-->>API: FoodOption[]
        API-->>Q: { cuisines, dishTypes, foods } + ETag
        Q-->>App: TasteOptions (persisted)
    end
    note over App: Picks reference option ids that map 1:1 to<br/>ranking values — no free text
~~~

## Classify Recipe — Implements F-CL-1: Tag a recipe's taste at import

One LLM call tags cuisine / meal_type / dish_type against the **expanded** cuisine vocabulary;
primary_ingredient stays FDC-grounded; and — new here — the ingredient→food match the nutrition
pipeline already computes is **persisted** so ingredient-level affinity has something to match.

~~~mermaid
sequenceDiagram
    participant Pipe as Import pipeline
    participant Cat as RecipeCategorizer
    participant Luna as LunaRecipeAnalyzer (LLM)
    participant Match as FoodMatcher
    participant Repo as RecipeRepository

    rect rgb(240, 248, 255)
    note over Pipe,Luna: Taste facets (expanded cuisine vocab)
    Pipe->>Cat: analyze(title, ingredients, steps)
    Cat->>Luna: classify (cuisine ∈ expanded VOCAB.cuisine)
    Luna-->>Cat: { cuisine, mealType, dishType, ... }
    note over Cat: constrain() keeps only VOCAB members<br/>(now includes tex_mex, cajun, …)
    end

    rect rgb(255, 248, 240)
    note over Pipe,Match: Persist the ingredient→food match (NEW)
    Pipe->>Match: match(ingredient.name) per ingredient
    Match-->>Pipe: FoodMatch { fdcId, category, quality }
    note over Pipe: write ingredients.fdc_id + quality<br/>(reuses the match nutrition already ran)
    end

    Pipe->>Repo: persist recipe (categories + ingredient fdc_ids)
~~~

## Score Affinity — Implements F-AF-1: Rank a recipe against food likes/dislikes

`AffinityScorer` gains a fourth facet, `ingredient`, matched against the recipe's persisted food
ids. An "okra" dislike now penalizes any recipe whose ingredients matched the okra food.

~~~mermaid
sequenceDiagram
    participant Eng as RankingEngine
    participant Repo as RecipeRepository
    participant Aff as AffinityScorer

    Eng->>Repo: load RankableRecipe (batched, no N+1)
    Repo-->>Eng: recipe.categories + recipe.foodIds  (from ingredients.fdc_id)
    Eng->>Aff: score(recipe, prefs)
    note over Aff: facets = cuisine, dish_type,<br/>primary_ingredient, ingredient
    note over Aff: ingredient sentiment = intersect<br/>prefs.foodPrefs(ingredient) with recipe.foodIds
    Aff-->>Eng: 0.5 + 0.5·mean(sentiments)
~~~

---

# Entities

~~~mermaid
classDiagram
    class Recipe {
        +string id
        +string title
    }
    class RecipeCategory {
        +Facet facet
        +string value
    }
    class Ingredient {
        +string name
        +int fdcId
        +MatchQuality matchQuality
    }
    class FdcFood {
        +int fdcId
        +string description
        +string category
    }
    class UserFoodPref {
        +AffinityFacet facet
        +string value
        +Sentiment sentiment
    }
    class TasteOption {
        +string id
        +Facet facet
        +string label
    }

    Recipe "1" --> "*" RecipeCategory : tagged with
    Recipe "1" --> "*" Ingredient : contains
    Ingredient "*" --> "0..1" FdcFood : matched to
    UserFoodPref "*" ..> "1" TasteOption : selected from
    RecipeCategory "*" ..> "1" TasteOption : matchable value
    FdcFood "*" ..> "1" TasteOption : ingredient option
~~~

`TasteOption` is a **view** over VOCAB (cuisines, dish types) and the curated `FdcFood` subset, not a
stored table — it is assembled by the endpoint. `UserFoodPref.facet` now admits `ingredient`, whose
`value` is a stringified `fdc_id`.

---

# Tables

## ingredients — changed

Adds the persisted ingredient→food match (already computed by the nutrition pipeline, discarded
today — the match in `NutritionEstimator.aggregate()` is transient,
`server/src/nutrition/nutrition-estimator.ts:102`). Full definition:
`server/src/schema.ts:204`.

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| fdc_id | integer | null, fk → fdc_foods.fdc_id | The matched FDC food; null when no match cleared the reject floor |
| match_quality | text | null, enum(high, medium, low) | The `FoodMatch.quality` tier (`server/src/nutrition/food-matcher.ts:5`) |

Index: `ingredients_fdc_idx` on `(fdc_id)` — the affinity join reads "recipes whose ingredients
matched food X."

## recipe_categories — unchanged

No schema change. `value` is a free string validated in app code, not a DB enum
(`server/src/schema.ts:246`), so expanding the cuisine vocabulary needs **no migration** — only a
`VOCAB` edit plus re-classification. This is the design's key affordance.

## user_food_prefs — unchanged schema, widened enum

`facet` is `AFFINITY_FACETS` (`server/src/schema.ts:529`). `AFFINITY_FACETS` gains `ingredient`
(`server/src/schema.ts:636`), an app-level tuple change, not a DB migration — the column is
`text`. `value` for an `ingredient` pref is the `fdc_id` as text.

## fdc_foods / fdc_foods_fts — unchanged

Read as-is (`server/src/schema.ts:406`, FTS mirror `server/drizzle/0002_fdc_fts.sql`). The
taste-options endpoint reads a curated subset; the affinity join reads `ingredients.fdc_id`.

---

# Modules

~~~mermaid
classDiagram
    class RecipeCategorizer {
        +analyze(title, ingredients, steps, servings) RecipeAnalysisResult
    }
    class FoodMatcher {
        +match(name) FoodMatch
    }
    class AffinityScorer {
        +score(recipe, prefs) number
        -facetSentiment(facet, values, prefs) number
        -ingredientSentiment(foodIds, prefs) number
    }
    class TasteOptionsService {
        +options() TasteOptions
    }
    class FdcFoodRepository {
        +tasteFoods() FoodOption[]
        +search(tokens) FdcFoodCandidate[]
    }
    class RecipeRepository {
        +persistIngredientMatches(tx, recipeId, matches)
        -foodIdsByRecipe(recipeIds) Map~string, int[]~
    }

    TasteOptionsService --> FdcFoodRepository : tasteFoods()
    RecipeCategorizer --> FoodMatcher : primary-ingredient + persisted match
    AffinityScorer --> RecipeRepository : recipe.foodIds
~~~

~~~mermaid
flowchart LR
    Vocab[VOCAB] -->|cuisines, dishTypes| TOS[TasteOptionsService]
    Repo[FdcFoodRepository] -->|FoodOption[]| TOS
    TOS -->|TasteOptions| Client[Onboarding/Settings]
    Client -->|foodPrefs facet/value| Prefs[user_food_prefs]
    Match[FoodMatcher] -->|fdcId| Ing[ingredients.fdc_id]
    Ing -->|foodIds| Aff[AffinityScorer]
    Prefs -->|ingredient prefs| Aff
~~~

`RankableRecipe` (`server/src/ranking/types.ts:4`) gains `foodIds: number[]`, batched into
`assembleRankable()` alongside categories/diets/equipment
(`server/src/repositories/recipe-repository.ts:461`) — no N+1.

---

# APIs

## Taste Options `GET /v1/taste-options`

Returns the full taste-picker catalog: cuisines, dish types, and the curated ingredient foods.
Served once, cached client-side. Authenticated (same `guard` as siblings,
`server/src/index.ts:156`).

### Request

- Headers
    - authorization: `Bearer <jwt>`
    - if-none-match: `<etag>` (optional; the cache revalidates cheaply)

### Success Response `200`

- Headers
    - content-type: `application/json`
    - etag: `<hash of VOCAB + food-catalog version>`
    - cache-control: `private, max-age=86400`
- Body
    - taste_options: object
        - cuisines: array of `{ value: string, label: string }`
        - dish_types: array of `{ value: string, label: string }`
        - foods: array of `{ value: string (fdc_id), label: string, group: string }`

`value` is the exact string a pick stores in `user_food_prefs.value`; the client no longer invents
labels. `group` is the food's `category`, so the picker can section the list.

### Not Modified Response `304`

- Headers
    - etag: `<etag>`
- Body: empty. The client keeps its cached catalog.

## Preferences `PUT /v1/preferences` — extended

Unchanged shape (`server/src/index.ts:186`); `foodPrefs` now accepts `facet: "ingredient"` with a
`value` that is an `fdc_id` string. The body validator adds `ingredient` to the allowed facet enum.

### Ingredient Facet Rejected Response `422`

- Body
    - error: object
        - code: int
        - message: string ("food value must be a known fdc_id")

Returned when an `ingredient` pref's `value` is not a real `fdc_id` — a trust-boundary check, since
the value indexes ranking.

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| F-TO-1: Serve taste options | Flow | | x | |
| F-CL-1: Classify recipe (expanded vocab + match persist) | Flow | x | x | |
| F-AF-1: Score affinity (ingredient facet) | Flow | x | x | |
| O-CL-1: `constrain()` keeps expanded cuisines | Op | x | | |
| O-AF-1: `ingredientSentiment()` intersection | Op | x | | |

## Test Approach

### Unit Tests

- **`AffinityScorer.ingredientSentiment`** — a recipe with `foodIds` `[168409]` and a `dislike`
  pref `{facet: "ingredient", value: "168409"}` scores −1 on that facet; a `like` scores +1; no
  overlap scores 0. Assert the four-facet mean centers on 0.5. Real scorer, hand-built
  `RankableRecipe` and `UserPreferences`.
- **`constrain()` / `valid()`** — an expanded `VOCAB.cuisine` (e.g. `tex_mex`) survives; a bogus
  value is dropped. Guards the exact chokepoint that silently swallowed richer picks today.
- **`FdcFoodRepository.tasteFoods`** — returns the curated subset with stable `value`/`label`/`group`,
  against the local `file:` fixture db (tests already pass one,
  `server/src/nutrition/fdc-food-repository.ts:46`). Never hits the network.

### Integration Tests

- **`GET /v1/taste-options`** — Hono app over the migrated local Postgres
  (`server/tests/helpers/global-setup.ts`); assert the three sections and that every `foods[].value`
  is a real `fdc_id`. Assert `304` on a matching `if-none-match`.
- **Classify → persist → affinity, end to end offline** — import a fixture recipe with an okra
  ingredient, assert `ingredients.fdc_id` is written, set an okra `dislike`, rank, assert the recipe's
  affinity breakdown is penalized. The `StubRecipeAnalyzer` runs when no key is set
  (`server/src/categorize/taste-classifier.ts:148`), so classification is deterministic offline; seed
  the cuisine tag directly to test the expanded-vocab path without the LLM.

### End-to-End Tests

Not required beyond the integration flow — the classification LLM call is the only networked step and
is stubbed offline per `server/CLAUDE.md` ("tests never hit the network").

## Test Infrastructure

The fixture FDC db needs a curated-taste-food row set and an okra food so the affinity join has a
target. Extend the existing WI-1 nutrition fixture rather than adding a new one.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | `ingredients.fdc_id`, `ingredients.match_quality`, `ingredients_fdc_idx` (adds only) | yes |
| 2 | code | Expand `VOCAB.cuisine`; add `ingredient` to `AFFINITY_FACETS` | yes |
| 3 | data | Re-seed recipes (reproducible seed) to re-classify against expanded vocab **and** backfill `ingredients.fdc_id` | n/a (rebuild) |

Migration 1 adds only — never a drop-plus-add on one table — so `drizzle-kit generate` stays
non-interactive (`docs/harvest-principles.md`, "stage destructive-plus-additive schema changes").
Old code ignores the new nullable columns; the new column is null until backfilled, and
`AffinityScorer` treats an empty `foodIds` facet as "no signal" (returns null, contributes nothing),
so the feature is dark until data lands.

## Data migration — re-seed, not a backfill LLM pass

The recipe seed is **reproducible** (per memory: "the recipe seed is reproducible"). Re-running it
re-classifies every recipe against the expanded `VOCAB` and populates `ingredients.fdc_id` from the
same match the nutrition step runs — no separate, costly LLM backfill over the live corpus. See the
Decisions section.

## Deploy Sequence

1. Schema migration 1 (nullable adds) — deployable ahead of code.
2. Code (expanded vocab + ingredient facet + endpoint) — old rows still rank; new facet stays null.
3. Re-seed off-hours; the deck refreshes on next fetch (client cache invalidates on the
   preferences/recipes keys per `docs/client-caching.md`).

## Rollback Plan

Roll back code independently — the new columns are nullable and unread by old code. If re-seed is
mid-flight, the affinity ingredient facet simply contributes null for un-backfilled recipes; nothing
breaks. No destructive migration to reverse.

---

# Monitoring

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| taste_options_served | counter | F-TO-1 | Catalog fetches (vs 304s) — confirms the serve-once cache holds |
| recipe_ingredient_match_rate | gauge | F-CL-1 | Fraction of ingredients that matched an fdc food at import — the ceiling on ingredient affinity |
| affinity_ingredient_hit_rate | gauge | F-AF-1 | Fraction of ranked recipes where an ingredient pref actually intersected — proves picks now bite |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| recipe_ingredient_match_rate drops after a seed | < 0.5 | warn |

## Logging

Log at `info`, low-cardinality: `unmatched_cuisine_from_llm` (an LLM cuisine that failed `inVocab`
after expansion) — surfaces vocabulary gaps to fold into the next `VOCAB` revision. No verbose
per-recipe logging in the import hot path.

---

# Decisions

## Persist the ingredient→food match rather than mapping foods to coarse classes

**Framework:** Binstack. Priorities (ranked): (1) a pick actually moves ranking, (2) reuse work
already done, (3) no new LLM cost, (4) small diff.

- **Persist `ingredients.fdc_id`** — materially moves (1): "okra" penalizes okra recipes at food
  granularity. Moves (2)/(3): the match is already computed in `NutritionEstimator.aggregate()`
  (`server/src/nutrition/nutrition-estimator.ts:102`) and thrown away; persisting it adds a column
  write, no new call. Moves (4): two nullable columns + one scorer facet.
- **Map foods → the 12 `primary_ingredient` classes** — fails (1): "okra" and "spinach" both collapse
  to `vegetable`; the pick can't distinguish them. No new work, but the signal is too coarse to be the
  feature.
- **Curated ingredient sub-vocab (a hand-picked ~200 foods)** — partially moves (1) but caps the
  catalog below the stated "all ~5,000 foods" goal and adds ongoing curation.

**Choice:** Persist the match. It is the only option that materially satisfies the top priority
(the pick bites at food granularity) *and* reuses computation already paid for.

### Alternatives Considered
- **Coarse primary-ingredient mapping:** too lossy — can't separate two vegetables.
- **Curated sub-vocab:** doesn't meet the all-foods goal; adds curation debt.
- **New recipe_foods join table:** redundant — the match is per-ingredient and `ingredients` already
  is that grain; a join table would denormalize what one nullable column expresses.

## Flat expanded cuisine list with parent fallback, re-seed to re-classify

**Framework:** Fermi ROI.

- **Impact:** high — unlocks tex-mex/cajun/creole/baja end to end; these are common and currently
  silently unmatched.
- **Effort:** low. Expanding `VOCAB.cuisine` is a code edit; because `recipe_categories.value` is a
  free string (`server/src/schema.ts:246`), **no migration**. Re-classification rides the reproducible
  re-seed — near-zero marginal effort vs. a bespoke backfill.
- **A backfill LLM pass over the live corpus** is higher effort (a new batch job, rate-limit handling
  per `docs/harvest-principles.md` tiered-escalation) for the same end state.

**Choice:** Flat list plus a parent map (`tex_mex → mexican`) used only as a **display/fallback**
grouping, not a second stored value; re-seed to re-classify. Highest ROI — biggest unlock for a
code-edit-plus-reseed.

### Alternatives Considered
- **Hierarchy stored as parent+child rows:** doubles the affinity match surface and complicates the
  scorer for a grouping the picker can compute client-side from the flat list.
- **Backfill LLM pass:** same result, higher cost and operational risk than re-seeding a reproducible
  corpus.

### Documentation
- Hono routing: `server/src/index.ts`
- Client caching pattern: `docs/client-caching.md`

## Serve the catalog once, not per-keystroke free-text search

**Framework:** Direct criterion — the founder set the delivery mechanism, and picks **must** map to a
ranking value (free text cannot). Serve-once also wins on latency and offline. Cache via the existing
TanStack Query + AsyncStorage model (`docs/client-caching.md`), keyed and revalidated by ETag.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Which foods are "taste-selectable"? All ~5,000 fdc_foods is a large payload; do we curate to the ingredient-like subset (exclude prepared dishes, beverages) and section by `category`? | open | [ASSUMPTION: serve a curated ingredient subset grouped by `category`; exclude non-ingredient WWEIA groups via the same rules `toPrimaryIngredient` already encodes at `server/src/categorize/fdc-category-map.ts:13`.] |
| Q-02 | Exact expanded cuisine list — which of tex-mex, baja, cajun, creole, soul_food, etc. does the founder want, and their parent-fallback map? | open | [ASSUMPTION: adopt the client's `ALL_CUISINES` set, snake_cased, as the seed list pending founder sign-off — same posture as the original `VOCAB` Q-01.] |
| Q-03 | Does an `ingredient` affinity pref match on the exact `fdc_id`, or also on the food's WWEIA `category` (so "no shellfish" catches every shellfish food)? | open | [ASSUMPTION: exact `fdc_id` for v1 (precise, uses the persisted match directly); category-level match is a fast follow if picks feel too narrow.] |
| Q-04 | ~5K-food payload size and shape — is one `GET` acceptable, or do we need gzip/field-trimming/pagination? | open | [ASSUMPTION: a curated subset (Q-01) gzips small enough for one cached response; measure before adding pagination — don't build it speculatively.] |
| Q-05 | Should the client fully drop its hardcoded corpora now, or read `GET /v1/taste-options` behind a fallback for one release? | open | [ASSUMPTION: read the endpoint as the single source of truth; keep the hardcoded list only as an offline-first render seed, deleted once the cache proves reliable.] |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-20 | Feature Lead (design agent) | Initial draft |
