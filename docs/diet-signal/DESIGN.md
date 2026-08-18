---
tags: [diet-signal], tdd
summary: "Diet-compatibility signal — technical design document"
locked: false
---

# Diet-Compatibility Signal

The last ranking signal: for each recipe, which diets it fits and which it rules out.
The punchline arrives early on purpose — **this is the allergen detector with a diet
config table and a net-carb check bolted on.** Nothing new to fetch, no new LLM call.
If that already sounds obvious, the design worked.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Founder (Jordan) | not_started | |
| Architect | not_started | |

---

# Background — an isolated step over the raw recipe

**The step depends on the raw recipe and nothing else.** It reads the recipe's intrinsic
fields — `title`, the parsed `StructuredIngredient[]`, `servings`, and any
source-published nutrition — and derives everything it needs itself. It never consumes
another step's output: not `nutritionStep`'s `estimate`, not `allergenStep`'s
`allergens`, not `categorizeStep`'s `categories`. So a nutrition step that withheld or
failed cannot degrade a diet verdict, and the step is a pure function of the recipe (see
D-00).

The rule that makes this free: **if an input is derivable without an LLM, regenerate it;
only a genuinely LLM-gated input would justify depending on the step that produced it.**
Reusing a *module* is not coupling; consuming a *step's output* is. The step calls the
shared `FoodMatcher` / `QuantityConverter` / FDC catalog as libraries and runs its own
match + gram-conversion pass — the same deterministic machinery `nutritionStep` and
`allergenStep` each run independently. Everything it needs is LLM-free:

1. **Per-ingredient FDC food-class** — its own `FoodMatcher.match` resolves each
   ingredient to an `fdcId`, a WWEIA food-category (`"Poultry"`, `"Cheese"`, `"Fish"`…),
   and a quality tier. Deterministic trigram search over the seeded SQLite catalog — no
   LLM, no network — so the step **regenerates it** rather than reuse the identical match
   `nutritionStep` and `allergenStep` each already run. Answers the *exclusion* diets
   (vegan, vegetarian, pescatarian, dairy-free): does any ingredient belong to a class
   the diet forbids?
2. **Per-serving net carbs** — its own gram-conversion + aggregation over those matches
   (preferring the recipe's source-published `grams_of_carbohydrate` / `grams_of_fiber`
   when present — an intrinsic extracted field, read raw, never via `estimate`), divided
   by `servings`. Also fully deterministic, so the step **regenerates it**. Answers the
   *macro* diets (keto, low-carb): net carbs = carbohydrate − fiber.

The one LLM-touched input — the ingredient list itself — is the recipe's own content, the
substrate every step takes (no recipe exists without it), not a derived enrichment. So
there is **no LLM-gated dependency to inherit**: the step regenerates everything and stays
a pure function of the recipe. It matches ingredients a fourth time; those three existing
passes (`server/src/workflows/import-workflow.ts`) prove that costs a handful of local
queries and no network — isolation's price, and a cheap one (D-00).

That split — exclusion diets from ingredients, macro diets from nutrients — is not our
invention. It is exactly how the incumbents draw the line (see Research).

## Research — how the field solves this

| Source | Exclusion diets | Macro diets | Notes |
|---|---|---|---|
| **Edamam** ([health vs diet labels](https://developer.edamam.com/edamam-docs-recipe-api-v1)) | `healthLabels` — "generated from **ingredient** information" (vegan = no meat/poultry/fish/dairy/eggs/honey) | `dietLabels` — "generated from **nutrient** information" (low-carb = <20% cal from carbs) | Keto is the telling exception: a *macro* rule living among the health labels — **"maximum 7 g net carbs per serving."** |
| **Spoonacular** ([diet definitions](https://spoonacular.com/food-api/docs/diet-definitions)) | Ingredient ontology (vegetarian = "no meat or meat by-products, such as bones or gelatin") | Ketogenic = "ratio of fat/protein/carbs… high-carb foods not acceptable" | Markets one capability loudest: it flags Worcestershire sauce as non-vegetarian *because of the anchovies*. The hidden-ingredient problem is the whole game. |
| **DietQA** ([2025, KG + rules](https://doi.org/10.3390/computers14100412)) | Ingredient→diet compliance edges (`true`/`false`/`conditional`) | "macronutrient-based diets… applied through threshold rules… **then** ingredient-level compatibility is checked" | Confirms the two-stage shape independently, in an academic system. |
| **Allergen-ML** ([MDPI 2022](https://www.mdpi.com/2076-3417/12/5/2590)) | — | — | The dominant error mode of automated ingredient classification is **missed items, not mislabels.** A miss on an exclusion diet is the *dangerous* direction. |
| **Vegan-labelling studies** ([FSA](https://science.food.gov.uk/article/126198), [Springer 2023](https://link.springer.com/article/10.1186/s13223-023-00836-w)) | — | — | Even regulated human-applied "vegan" labels are **not** allergen-safety guarantees. This is a ranking hint, never a safety claim. |

The convergence is total: every serious system blocks ingredients for exclusion diets
and thresholds macros for numeric diets, and every one risks the same failure —
*silently* passing a recipe as compatible when an ingredient went unrecognized or an
animal derivative hid inside a sauce. The design below is that consensus, wired to the
FDC matches we already compute.

---

# Use Case Implementations

## Diet signal — Implements the ingest enrichment (isolated step)

The signal is a new best-effort step, `dietStep`. It takes only the raw recipe and
derives everything itself — pure compute over the seeded catalog, no network, no LLM, no
dependency on `nutritionStep` / `allergenStep` / `categorizeStep` output (D-00). Because
it consumes nothing they produce, it may run any time after `resolveRecipes` — including
concurrently with the other enrichments.

~~~mermaid
sequenceDiagram
    participant W as importWorkflow
    participant D as DietClassifier
    participant M as FoodMatcher
    participant R as FdcFoodRepository (SQLite)

    rect rgb(240, 248, 255)
    note over W,D: dietStep — one call per resolved recipe
    W->>D: classify(ingredients, servings, recipe.nutrition?)
    note over D: inputs are the recipe's own fields — never estimate/allergens/categories
    end

    rect rgb(255, 248, 240)
    note over D,R: Exclusion diets — its own match pass, per ingredient
    loop each ingredient
        D->>M: match(name)
        M->>R: trigram search
        R-->>M: {fdcId, category, quality}
        M-->>D: FoodMatch | null
        note over D: unmatched → coverage=false, contributes no "compatible"
        note over D: category → foodClass (dairy, meat, egg, grain…)
        note over D: name hits hidden-animal blocklist → non-veg/vegan blocker
    end
    end

    rect rgb(245, 245, 235)
    note over D: Macro diets — its own net-carb calc
    note over D: netCarbs = (published carbs/fiber, else own aggregation) ÷ servings
    note over D: keto = netCarbs ≤ threshold; no basis → unknown
    end

    D-->>W: DietCompat { fit: Record<DietId, Verdict>, blockers }
    note over W: attach to ExtractedRecipeData; persistStep writes the column
~~~

**Regenerate, don't inherit (D-00).** `nutritionStep` and `allergenStep` also loop
`FoodMatcher.match` over these ingredients, so a merged one-pass design would save a
match. We reject it: both the match and the net-carb calc are **LLM-free and
deterministic**, so `dietStep` regenerates them and stays independent. The only input it
can't regenerate — the ingredient list — is the recipe's own content, not a step's
output. A fourth local match pass is the whole cost of that independence.

---

# Entities

~~~mermaid
classDiagram
    class Recipe {
        +String title
        +Ingredient[] ingredients
        +Nutrition nutrition
        +DietCompat dietCompat
    }
    class DietCompat {
        +Map~DietId,Verdict~ fit
        +Map~DietId,Blocker~ blockers
        +bool coverageComplete
    }
    class DietRule {
        +DietId id
        +FoodClass[] blockedClasses
        +String[] blockedIngredients
        +MacroRule macro
    }
    class Verdict {
        <<enumeration>>
        compatible
        incompatible
        unknown
    }
    Recipe "1" --> "1" DietCompat : signal
    DietCompat "*" ..> "*" DietRule : evaluated against
    DietCompat --> Verdict : per diet
~~~

`DietRule` is config, not a stored entity — see Decisions. `DietCompat` is the in-memory
aggregate the classifier returns; it persists as a row per diet in `recipe_diets` (see
Tables).

---

# Tables

## `recipe_diets` — new child table

One row per (recipe, configured diet). Mirrors the existing `recipe_categories` child
table (`recipe_id`, `facet`, `value`) — the repo's settled pattern for a recipe's derived
labels — rather than a JSON blob on `recipes`. A dedicated table earns its keep here: the
downstream "surface recipes that fit diet X" query becomes an indexed lookup, and each
verdict + blocker is a first-class row the ranking join reads directly.

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| recipe_id | uuid | not null, fk → `recipes.id`, on delete cascade | |
| diet_id | text | not null | A `DietRule.id` (`vegan`, `keto`, …). |
| verdict | text | not null, check ∈ (`compatible`,`incompatible`,`unknown`) | |
| blocker_kind | text | null, check ∈ (`ingredient`,`macro`) | Present only for `incompatible`. |
| blocker_value | text | null | The offending ingredient name or macro (e.g. `bacon`, `net_carbs`). |
| blocker_class | text | null | The `FoodClass` that disqualified (e.g. `meat`). |

- **Primary key:** `(recipe_id, diet_id)` — one verdict per diet per recipe.
- **Index** `recipe_diets_lookup` on `(diet_id, verdict)` — serves "recipes compatible
  with diet X" without scanning.
- A recipe with **no rows for a diet** reads as *undetermined* for it (signal withheld:
  no ingredients, or the step failed), never *"fits everything."* `unknown` is stored
  explicitly only when the step ran and couldn't decide.

Coverage-completeness (did every ingredient match?) is a per-recipe monitoring signal, not
per-diet state — it stays in the log line (see Monitoring), not a stored column. Its
consequence is already visible: inadequate coverage is exactly when an exclusion diet's
row reads `unknown`.

Example rows for a bacon-topped salad:

| recipe_id | diet_id | verdict | blocker_kind | blocker_value | blocker_class |
|---|---|---|---|---|---|
| …a1 | vegan | incompatible | ingredient | bacon | meat |
| …a1 | vegetarian | incompatible | ingredient | bacon | meat |
| …a1 | keto | compatible | | | |
| …a1 | pescatarian | unknown | | | |

---

# Modules

~~~mermaid
classDiagram
    class DietClassifier {
        +classify(ingredients, servings, publishedNutrition?) DietCompat
    }
    class FoodClassMap {
        +toFoodClass(fdcCategory) FoodClass?
    }
    class NetCarbs {
        +perServing(matches, servings, published?) number?
    }
    class DietRules {
        +DietRule[] ALL
    }
    class FoodMatcher {
        <<interface>>
        +match(name) FoodMatch?
    }
    DietClassifier --> FoodMatcher : its own match pass
    DietClassifier --> FoodClassMap : category → class
    DietClassifier --> NetCarbs : own net-carb calc
    DietClassifier --> DietRules : blocklists + thresholds
~~~

~~~mermaid
flowchart LR
    subgraph raw["raw recipe fields only"]
      ING[StructuredIngredient]
      SRV[servings]
      PUB[published carbs/fiber?]
    end
    ING -->|name| FM[FoodMatcher]
    FM -->|fdcCategory| FCM[FoodClassMap]
    FCM -->|FoodClass| DC[DietClassifier]
    FM -->|grams| NC[NetCarbs]
    PUB --> NC
    SRV --> NC
    NC -->|netCarbs| DC
    RULES[DietRules config] --> DC
    DC -->|DietCompat| PERSIST[persistStep]
~~~

Every arrow into `DietClassifier` originates from the **raw recipe** or from config —
none from another step's output (D-00). `DietClassifier` is a class with a
`static create(db)` factory that wires the `FoodMatcher` singleton, exactly like
`AllergenDetector.create`. `NetCarbs` is the small deterministic gram-convert +
aggregate the step owns (mirroring `NutritionEstimator`'s internals, not calling it).
`FoodClassMap` is the `toPrimaryIngredient` sibling — same "keyword over the WWEIA
description" approach, but **coarser and diet-complete** (it must classify
dairy/milk/butter and fats, which `toPrimaryIngredient` deliberately collapses to
`null`).

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| `DietClassifier.classify` | Op | x | | |
| `FoodClassMap.toFoodClass` | Op | x | | |
| net-carb / macro thresholds | Op | x | | |
| `dietStep` in the import workflow | Flow | | x | |
| Full import → diet_compat persisted | Flow | | | x |

## Test Approach

**Unit (the ground truth test).** A golden fixture of ~30 hand-labelled recipes spanning
the diet matrix: an all-clear vegan bowl, a bacon-topped salad (blocks vegan +
vegetarian), a fish taco (blocks vegetarian, passes pescatarian), a hidden-anchovy Caesar
(the Worcestershire case — must block vegetarian *without* an obvious meat), a 5 g-net-carb
steak (keto) vs a 40 g-net-carb pasta, and a recipe with two unmatched ingredients
(must read `unknown`, never `compatible`, on exclusion diets). Assert the full `fit` map
and blockers. This is the whole correctness argument — it lives or dies here. Mirrors
`nutrition-matching.test.ts` / `recipe-categorizer.test.ts` (offline FDC stub, no
network).

**Unit — the maps and math.** `toFoodClass` over representative WWEIA categories
(including the ones `toPrimaryIngredient` drops); net-carb subtraction and threshold
boundaries. Don't test the FDC match itself — it's covered by nutrition tests, and
retesting a dependency's guarantee is waste (per `server/CLAUDE.md`).

**Integration.** `dietStep` runs in the workflow and writes `recipe_diets` rows; a
classifier failure leaves the recipe unsignalled (no rows) and does **not** fail the
import — the same best-effort contract every other enrichment step honours.

**E2E.** Extend the existing import e2e: import a known recipe, assert its `recipe_diets`
rows land in the DB and surface through the recipe read.

## Test Infrastructure

None new. Reuses the offline FDC catalog stub the nutrition and allergen suites already
seed.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Create `recipe_diets` table + `(diet_id, verdict)` index | yes — new table, old code ignores it |

Backfill is unnecessary: an old recipe with no rows reads *undetermined*, the honest
state, and re-import or a future one-off recompute fills them. No data migration ships
with this design.

## Rollback Plan

Code rolls back independently of the migration — the new table is inert when unread. Pull
`dietStep` from the workflow; the table simply stops being written (and can be dropped
later).

---

# Monitoring

Following the repo's "log line is the metric" convention (`allergenStep` emits its own),
`dietStep` logs one info line per recipe:

## Metrics (derived from the log line)

| Name | Type | Use Case | Description |
|---|---|---|---|
| diet_signal_outcome{signalled\|withheld\|error} | counter | Signal emitted | Did the recipe get a signal at all? |
| diet_coverage_complete{true\|false} | counter | Correctness | Fraction of recipes where every ingredient matched — the silent-failure risk gauge. A falling rate means more `unknown` exclusion verdicts. |
| diet_fit{diet,verdict} | counter | Signal shape | Distribution of verdicts per diet — sanity-checks the config (e.g. if *nothing* is ever keto, the threshold or macro coverage is wrong). |

## Logging

`[step] diet job=… title=… fit=vegan:incompatible,keto:compatible complete=false recognized=<n/total>` — low-cardinality, one line, no hot-path spam.

---

# Decisions

## D-00 — An isolated step: regenerate LLM-free inputs, depend on no prior step

**Framework:** Direct criterion — *for each input, is it derivable without an LLM? If so,
regenerate it; only an LLM-gated input would justify a cross-step dependency.*

The step needs two things beyond the raw recipe: per-ingredient FDC food-class, and
per-serving net carbs. Both are produced by `nutritionStep`/`allergenStep` — but both are
**deterministic, local, LLM-free** (trigram search + gram-convert over the seeded SQLite
catalog). So the step regenerates them with its own pass and reads none of those steps'
output. The only LLM-touched input, the ingredient list, is the recipe's own content —
the substrate every step takes, not a derived enrichment — so there is no LLM-gated
dependency to inherit.

**Choice: `dietStep` is a pure function of the raw recipe.** It consumes no `estimate`,
`allergens`, or `categories`. Consequences: a withheld/failed nutrition step can't degrade
a diet verdict; the step is order-independent (it may run concurrently with the other
enrichments); and it's trivially unit-testable from a recipe alone.

**Cost:** a fourth `FoodMatcher` pass over the ingredients. The three existing passes prove
it's a handful of local queries and no network — a cheap price for independence.

- **Alternative — fold classification into `AllergenDetector`'s loop** (one match pass,
  both outputs): rejected. It couples two concerns and makes each step's failure the
  other's, to save a local match that costs nothing measurable.
- **Alternative — read `nutritionStep`'s `estimate` for macros**: rejected. Net carbs are
  LLM-free to recompute, so the dependency buys nothing and forfeits isolation.

## D-01 — Output shape: a three-state verdict per diet, plus the blocker

**Framework:** Direct criterion — *what does ranking actually consume, and what can we
assert honestly?*

Ranking needs, per user diet: boost the fits, bury the misfits, stay neutral on the
rest. Three states map to exactly that: `compatible` → boost, `incompatible` → bury,
`unknown` → neutral.

**Choice: `Verdict = compatible | incompatible | unknown` per configured diet, plus the
offending ingredient/macro (`blocker`) for the non-`unknown` verdicts.**

- **Why not a plain boolean** (Edamam/Spoonacular emit booleans). A boolean forces
  "no blocker found" to read as `compatible` — but our matcher has recall gaps, so
  "found nothing" often means "couldn't see." The third state `unknown` is the entire
  honesty of the design: it separates *confirmed fit* from *can't tell*. This is the
  same distinction `allergensComplete` already draws.
- **Why not a graded 0–100 fit score.** Diet compatibility is categorical — a dish with
  bacon is not "80% vegan." A graded score invents precision that doesn't exist and
  gives ranking a knob it doesn't need (it already has NRF for "how healthy"). Deleted.
- **Why keep the blocker.** We hold the offending ingredient the instant we find it —
  storing it is nearly free and pays for itself three times: it's the validation hook
  (the golden test asserts *why*), the debugging hook, and the seed for the
  (out-of-scope) "not vegan: contains bacon" UI. `unknown` carries no blocker — there's
  nothing to name.

**Which framing (the prompt's question).** The signal's confident framing is
*exclusion* — "incompatible, and here's the blocker" — because a blocklist can prove a
misfit from a single ingredient. "Great for this diet" is the same signal's `compatible`
verdict, assertable **only** when coverage is high enough to trust the absence of
blockers. Both framings fall out of one enum; we don't compute them separately.

## D-02 — Diets are config (a rule schema), not code

**Framework:** Binstack — priorities: (1) add a diet without a deploy-shaped code change,
(2) don't fake diets the data can't support, (3) match existing repo patterns.

Every diet in scope reduces to the same two primitives: *a set of forbidden food-classes*
and *a macro threshold*. So a diet is data:

~~~ts
interface DietRule {
  id: DietId;                    // 'vegan' | 'vegetarian' | 'pescatarian' | 'keto' | ...
  blockedClasses: FoodClass[];   // e.g. vegan → [meat, poultry, seafood, dairy, egg, honey]
  blockedIngredients?: string[]; // hidden-animal names FDC categories miss (see D-03)
  macro?: { netCarbsMaxPerServing?: number };  // keto → 7
}
~~~

**Choice: the per-diet composition is config; the primitives are code.** Adding
pescatarian, dairy-free, red-meat-free, or carnivore (an *inverse* blocklist — block the
plant classes) is a new `DietRule` entry, no new code.

**Where the line sits — and where it stops.** Code owns the primitives: the
FDC-category→`FoodClass` map, the net-carb computation, the classify-and-fail-safe loop.
Config owns the composition. But config only reaches diets that **reduce** to
{class blocklist + macro threshold}. **Paleo, Whole30, and low-FODMAP do not** — they
turn on ingredient-level distinctions finer than WWEIA categories carry (paleo bans
potatoes but allows honey and sweet potato; Whole30 allows ghee but not butter; FODMAP is
a per-food dose threshold). Faking them on FDC categories would produce confident-wrong
verdicts — the exact silent failure we're avoiding. They are **out of scope** for this
config and flagged as such (Q-03), not quietly approximated.

This mirrors the repo's settled pattern: `VOCAB` and the `NRF` tables are "a code
constant, not a table… so revising it is a code change." `DietRule[]` is the same — a
tunable code constant pending dietician sign-off, not a DB-managed rule engine (that would
be infra before a caller — YAGNI).

- **Alternative — hardcoded `isVegan()` / `isKeto()` functions:** rejected. N near-identical
  functions differing only in a blocklist; a new diet means new code and new tests for
  logic that's already tested once.
- **Alternative — a DB-backed rules table with admin UI:** rejected. No second editor, no
  runtime-edit requirement. Infrastructure before a user.

## D-03 — Hidden-ingredient blocklist: the one genuinely new artifact

**Framework:** Direct criterion — *close the documented #1 silent failure at the smallest
cost.*

FDC categories classify whole foods, so they will never flag the anchovies inside
Worcestershire, the pork in gelatin, the fish in nam pla, or honey. Spoonacular treats
catching these as its headline feature; skipping them means confidently calling a Caesar
salad vegetarian.

**Choice: a short, curated, high-precision `blockedIngredients` name list** (worcestershire,
anchovy, gelatin, fish sauce, oyster sauce, rennet, lard, honey, …) matched against
ingredient names, per diet. It is the **only** new dataset this design introduces.

**Cost and ceiling — stated plainly.** Zero LLM cost, zero network. A hand-maintained
list of dozens of names — high-precision but **never exhaustive**, growing as misses
surface (a monitoring-driven backlog, not an ML problem).
`ponytail:` naive substring list, upgrade to a synonym/derivative ontology only if the
miss rate proves it worth the weight.

## D-04 — Placement: order-independent, fail-safe toward `unknown`

**Framework:** Direct criterion — *the step is self-contained, so run it anywhere valid;
fail in the safe direction.*

Because it depends only on the raw recipe (D-00), `dietStep` may run any time after
`resolveRecipes` and before `persistStep` — including concurrently with
`nutritionStep`/`allergenStep`/`categorizeStep`, since it shares no data with them. It
lands as a best-effort step like its siblings; the initial wiring runs it after
`allergenStep` for readability, but nothing forces that order.

**The fail-safe rule, stated once:** never assert `compatible` for an exclusion diet
without adequate ingredient coverage — default to `unknown`. The asymmetry justifies it:
recommending a bacon dish to a vegan (false-`compatible`) is a trust-breaking error;
under-ranking a good recipe (false-`unknown`) merely costs it a boost. So the signal is
*conservative about claiming a fit* and *eager to claim a miss* — precisely the shape
`AllergenDetector` already encodes ("an ingredient we cannot match… reads *undetermined*,
never *absent*"). Concretely:

- unmatched / `low`-quality ingredient → contributes no "clear," drops coverage;
  below the coverage bar → exclusion verdicts become `unknown`, not `compatible`.
- `medium`-quality match → softened, same as the allergen detector caps it at
  `may_contain`.
- missing macros or servings → keto/low-carb → `unknown`, never `incompatible`.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Merge diet classification into `AllergenDetector`'s loop, or keep a separate `dietStep`? | resolved | **Separate, isolated step (D-00).** Both inputs are LLM-free, so `dietStep` regenerates them and depends on no prior step; the saved match isn't worth the coupling. |
| Q-02 | JSON column on `recipes` vs a normalized child table for the diet info. | resolved | **Separate `recipe_diets` child table**, mirroring `recipe_categories`; the "recipes that fit diet X" query becomes an indexed lookup. |
| Q-03 | Confirm the launch diet list and that paleo / Whole30 / low-FODMAP are **deferred** (not FDC-expressible). Proposed launch set: vegan, vegetarian, pescatarian, dairy-free, red-meat-free, keto, low-carb, carnivore. | open | |
| Q-04 | Dietician sign-off on the numbers: keto net-carb ceiling (Edamam uses 7 g/serving), low-carb definition (Edamam: <20% cal from carbs), and the coverage threshold that flips an exclusion verdict to `unknown`. | open | |
| Q-05 | `blockedIngredients` starting list — who owns curating and growing it from the `diet_coverage_complete` miss backlog? | open | |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-17 | Diet-signal Lead | Initial draft |
| 2026-08-17 | Diet-signal Lead | Isolate `dietStep` (D-00): regenerate LLM-free inputs, depend on no prior step (resolves Q-01). Move diet info to a separate `recipe_diets` table (resolves Q-02). |
