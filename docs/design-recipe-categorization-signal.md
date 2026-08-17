---
tags: [harvest, ranking], tdd
summary: "Recipe dish/cuisine categorization signal — technical design document"
locked: false
---

# Recipe Categorization Signal — Design

The recipe-side input to the ranking engine's taste-affinity signal. At ingest, attach a small
**faceted taxonomy** to every recipe — `cuisine`, `dish_type`, `primary_ingredient` — filled by a
tiered **FDC-category → rules → LLM** step that mirrors the existing nutrition step.

**In scope:** the metadata attached to a recipe at ingest, and the step that derives it.
**Out of scope:** the ranking engine, per-user preference capture, and signal weighting. This document
produces the labels a later taste-match reads; it does not read them.

This is Direction B from the categorization spike. The spike's prior-art grounding is not repeated
here; this document specifies the build.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Backend Tech Lead (author) | in_progress | |
| Architect | not_started | |
| Founder | not_started | |

---

# Use Case Implementations

Work items use the taste-signal prefix **TS**. `F-TS-01` is the ingest-time flow; the `O-TS-*`
operations are its reusable internals.

## Categorize During Import — Implements F-TS-01: Attach Facets at Ingest

The categorizer slots into the durable import workflow as one new `"use step"` — `categorizeStep` —
placed after `nutritionStep`, before `persistStep`. It is **best-effort enrichment**: a failure
returns the recipe un-categorized rather than failing an import that would otherwise succeed. This
is the exact shape and failure posture of `nutritionStep` (`server/src/workflows/import-workflow.ts`).

~~~mermaid
sequenceDiagram
    participant WF as importWorkflow
    participant CS as categorizeStep
    participant RC as RecipeCategorizer
    participant FM as FoodMatcher
    participant RT as RuleTagger
    participant CL as CuisineClassifier
    participant PS as persistStep

    rect rgb(240, 248, 255)
    note over WF,CS: after nutritionStep, before persistStep
    WF->>CS: categorizeStep(recipes, input)
    end

    rect rgb(255, 248, 240)
    note over CS,CL: per recipe, concurrent via Promise.all
    loop each recipe, best-effort
        CS->>RC: categorize(title, ingredients)
        RC->>FM: match(name) per ingredient
        FM-->>RC: FDC food group, e.g. Finfish and Shellfish
        note over RC: seed primary_ingredient from FDC category
        RC->>RT: tag(title, ingredientNames)
        RT-->>RC: hits for cuisine, dish_type, primary_ingredient
        alt cuisine still unknown
            RC->>CL: classify(title, names, VOCAB)
            CL-->>RC: cuisine value from VOCAB
        end
        RC-->>CS: RecipeCategories
        note over CS: attach categories to ExtractedRecipeData
    end
    end

    rect rgb(240, 255, 240)
    note over CS,PS: one log line per recipe, then persist
    CS-->>WF: enriched recipes
    WF->>PS: persistStep(recipes, input)
    note over PS: toRecipeInput folds in categories,<br/>persistWith inserts recipe_categories rows in the same txn
    end
~~~

**Extension — categorization throws (E1).** `categorizeOne` wraps `RecipeCategorizer.categorize` in
`try/catch`; on error it logs `outcome=error` and returns the recipe with no `categories`. Persist
writes zero `recipe_categories` rows for it. The import still reaches `ready`.

**Extension — a facet stays empty (E2).** Any tier may yield nothing for a facet (no FDC match, no
rule hit, LLM low-confidence). That facet simply has no rows; the recipe persists with the facets it
did get. No placeholder, no `unknown` value.

## Derive Facets — Implements O-TS-01: Tiered Categorization

The tiers run cheapest-first and each narrows what the next must do. `RecipeCategorizer.categorize`
runs all three, then merges (O-TS-05). The worked example threaded through every diagram below is:

> **Title:** "Shrimp Scampi" **Ingredients:** shrimp, spaghetti, garlic, chicken broth
> **Expected:** `cuisine=[italian]`, `dish_type=[pasta]`, `primary_ingredient=[seafood]`
> (chicken broth must **not** make it poultry — that's the dominance problem).

~~~mermaid
sequenceDiagram
    participant RC as RecipeCategorizer
    participant FM as FoodMatcher
    participant RT as RuleTagger
    participant CL as CuisineClassifier

    note over RC: Tier 1 - FDC seed per ingredient, see O-TS-03
    loop each ingredient
        RC->>FM: match(name)
        FM-->>RC: FoodMatch or null
    end

    note over RC: Tier 2 - RuleTagger over title and names, see O-TS-04
    RC->>RT: tag(title, ingredientNames)
    RT-->>RC: FacetHits for dish_type, cuisine, primary_ingredient

    note over RC: Tier 3 - LLM only if rules left cuisine empty
    alt cuisine unresolved
        RC->>CL: classify(title, names, VOCAB)
        CL-->>RC: cuisine value from VOCAB
    end

    note over RC: merge with precedence and dominance, see O-TS-05
~~~

## Match One Ingredient to a Facet — O-TS-03: FDC-Seed Matching

This is the core "how matching works." It **reuses `FoodMatcher` verbatim** — the same
`normalize → FTS5 trigram search → bm25 tiering` path the nutrition estimator already runs. The only
new piece is `FdcCategoryMap`, a small lookup from an FDC food group to a `primary_ingredient` VOCAB
value. No fuzzy logic of our own; the fuzziness is FTS5's, already tuned for nutrition (WI-1).

~~~mermaid
sequenceDiagram
    participant RC as RecipeCategorizer
    participant FM as FoodMatcher
    participant NM as normalize
    participant FR as FdcFoodRepository
    participant MAP as FdcCategoryMap

    note over RC: ingredient name is shrimp peeled
    RC->>FM: match(shrimp peeled)
    FM->>NM: normalize(name)
    NM-->>FM: shrimp
    FM->>FR: search(shrimp) via FTS5 trigram bm25
    FR-->>FM: best row Finfish and Shellfish, bm25 -9.2
    note over FM: tier bm25, -9.2 below -6.0, so quality high
    FM-->>RC: FoodMatch fdcId, category Finfish and Shellfish, high
    RC->>MAP: toPrimaryIngredient(Finfish and Shellfish)
    MAP-->>RC: seafood
    note over RC: candidate seafood, quality high, source fdc

    note over RC: now the chicken broth ingredient, same path
    RC->>FM: match(chicken broth)
    FM-->>RC: FoodMatch category Soups Sauces and Gravies, medium
    RC->>MAP: toPrimaryIngredient(Soups Sauces and Gravies)
    MAP-->>RC: null
    note over RC: no candidate, dropped
~~~

**Extensions.**
- **No match (E3).** `FoodMatcher.match` returns `null` (below the reject floor) → no candidate for
  that ingredient; skip it.
- **Match, but no facet mapping (E4).** `FdcCategoryMap.toPrimaryIngredient` returns `null` for groups
  that aren't a primary ingredient (broths, sauces, spices) → no candidate. This is what keeps
  "chicken broth" from tagging poultry, *before* dominance even runs.
- **Ambiguous FDC group (Q-02).** "Cereal Grains and Pasta" conflates grains and pasta; the map needs
  a rule (or defers that value to the RuleTagger, which distinguishes "spaghetti" → pasta). Open.

## Match Keywords to Facets — O-TS-04: RuleTagger

`RuleTagger` is a pure function over a curated `KEYWORD_DICT` (a gazetteer): each entry maps a keyword
to `{ facet, value }`. It scans the **title** and the **ingredient names** separately, tagging each
hit with where it was found — because a title hit outranks a body hit in the merge (dominance). It is
the only tier that produces `dish_type`, and it produces cuisine when a keyword is unambiguous
("aglio e olio", "taco").

~~~mermaid
sequenceDiagram
    participant RC as RecipeCategorizer
    participant RT as RuleTagger
    participant D as KEYWORD_DICT

    RC->>RT: tag(title Shrimp Scampi, ingredient names)
    note over RT: lowercase and tokenize the title, then the names

    RT->>D: look up title tokens shrimp and scampi
    D-->>RT: shrimp is primary seafood, scampi is dish pasta
    note over RT: both flagged location TITLE

    RT->>D: look up ingredient tokens
    D-->>RT: spaghetti is dish pasta, chicken is primary poultry
    note over RT: flagged location BODY

    RT-->>RC: FacetHits - dish pasta, primary seafood TITLE and poultry BODY
~~~

Note the dict deliberately does **not** map "garlic" or "chicken broth" to a cuisine or protein — the
gazetteer is conservative (high-precision keywords only); recall comes from the FDC seed and the LLM.
"chicken" here is a `BODY` hit that dominance will discard.

## Merge & Dominance — O-TS-02 / O-TS-05: Assemble RecipeCategories

The merge decides the final value set per facet, applying **precedence** (which tier owns a facet) and
**dominance** (title beats body for `primary_ingredient`). This is where "chicken broth" loses.

~~~mermaid
sequenceDiagram
    participant RC as RecipeCategorizer
    participant CL as CuisineClassifier
    participant V as VOCAB

    note over RC: inputs - FDC candidate seafood high,<br/>rules dish pasta, primary seafood TITLE and poultry BODY, cuisine none

    note over RC: dish_type - rules only, FDC and LLM do not produce it<br/>result dish_type is pasta

    note over RC: primary_ingredient dominance O-TS-02 -<br/>1. title rule hit seafood TITLE wins outright<br/>2. else FDC candidates, keep highest quality, drop pantry<br/>poultry was BODY only, so discarded<br/>result primary_ingredient is seafood

    note over RC: cuisine - rules empty, so escalate
    RC->>CL: classify(title Shrimp Scampi, names, VOCAB cuisine)
    CL-->>RC: italian
    note over RC: result cuisine is italian

    RC->>V: validate every value is in VOCAB, then dedup
    V-->>RC: ok
    note over RC: RecipeCategories - cuisine italian, dish_type pasta, primary_ingredient seafood
~~~

**Dominance rule for `primary_ingredient` (O-TS-02), see Q-03 before finalizing:**

1. **Title rule hit wins.** A `TITLE`-location RuleTagger hit ("Shrimp Scampi" → seafood) is the value,
   full stop.
2. **Else FDC-seeded, filtered.** No title hit → take the FDC candidates, keep the highest-`quality`
   one(s), drop pantry/broth groups (already `null`-mapped in O-TS-03). A coarse stand-in for the
   spike's mass×rarity score — we lack per-ingredient mass at ingest, so title-priority carries the
   hard cases.

`BODY`-location rule hits (like "chicken") never win on their own; they only corroborate an FDC
candidate. That is the single rule that resolves the shrimp-vs-chicken-broth case.

---

# Entities

`Recipe` gains a composition of `RecipeCategory` value objects. The controlled vocabulary itself is a
**code constant** (`VOCAB`), not an entity — it is small, versioned with the code, and has no
independent lifecycle (see Decisions).

~~~mermaid
classDiagram
    class Recipe {
        +string id
        +string title
        +SourceType sourceType
        +List~RecipeCategory~ categories
    }
    class RecipeCategory {
        +Facet facet
        +string value
    }
    class Facet {
        <<enumeration>>
        cuisine
        dish_type
        primary_ingredient
    }
    Recipe "1" *-- "*" RecipeCategory : categories
    RecipeCategory --> Facet
~~~

A recipe holds 0..N categories per facet (multi-label: shrimp scampi is `dish_type=pasta` **and**
`primary_ingredient=seafood`). Provenance — which tier assigned a value — is **not** an entity
attribute; it lives only in the per-recipe log line, for debuggability and the fallback-rate metric.

---

# Tables

## recipe_categories (new)

One row per (recipe, facet, value). The signal must be **queryable by value** — ranking's candidate
generation asks "which recipes are `primary_ingredient=seafood`?", a filter across rows. That rules
out a JSON array on `recipes` (SQLite can't index a contained array element; it would scan
`json_each`) and calls for a normalized child table with a value index. Composite primary key, no
synthetic id — matching the schema's other join tables (`import_job_recipes`, `fdc_food_nutrient`).

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| recipe_id | text | not null, fk → recipes.id (on delete cascade) | children fall away with the recipe |
| facet | text | not null, enum('cuisine','dish_type','primary_ingredient') | which axis |
| value | text | not null | a controlled-vocabulary value (validated in code against `VOCAB`) |

Compound primary key **(recipe_id, facet, value)** — a value is tagged at most once per recipe, and
with `onConflictDoNothing` the categorize-then-persist is idempotent across a workflow replay (matching
`persistAndReady`'s replay-safety). `value` is free `text` at the DB layer, constrained to `VOCAB` in
application code — the same posture the schema takes for other controlled strings (e.g.
`fdc_foods.category`), and it keeps the vocabulary revisable without a migration.

## Indices

| Name | Columns | Unique | Rationale |
|---|---|---|---|
| (primary key) | (recipe_id, facet, value) | yes | dedup + idempotent replay; serves recipe-prefixed reads |
| recipe_categories_value_idx | (facet, value) | no | **the queryable path** — "all recipes tagged `seafood`" for ranking candidate generation |

The `(facet, value)` index is the reason this is a table and not a column: it turns "find seafood
recipes" into an index range scan returning `recipe_id`s, which is what the ranking retrieval step
will do.

## fdc_foods (existing, unchanged)

No change. `fdc_foods.category` (the FDC food group) is already populated by the WI-1 seed and already
surfaced by `FoodMatcher` as `FoodMatch.category` — the categorizer reads it, adds nothing.

---

# Modules

`RecipeCategorizer` is a class with a `static create(db)` factory that hand-wires its collaborators
(the repo convention). It **reuses** `FoodMatcher` / `FdcFoodRepository` verbatim — no new FDC code.
`CuisineClassifier` is an interface with a live OpenAI-Luna implementation and an offline stub,
selected by env like `selectExtractor()`. The Luna implementation reuses the existing OpenAI chat
seam (same endpoint, model id, and `OPENAI_API_KEY` as `ChatExtractor.openai()`), differing only in
the prompt (classify-into-VOCAB, not extract).

~~~mermaid
classDiagram
    class RecipeCategorizer {
        +categorize(title, ingredients) RecipeCategories
        +create(db) RecipeCategorizer
    }
    class RuleTagger {
        +tag(title, names) FacetHits
        -KEYWORD_DICT
    }
    class FdcCategoryMap {
        +toPrimaryIngredient(group) value
    }
    class CuisineClassifier {
        <<interface>>
        +classify(title, names, vocab) cuisineList
    }
    class LunaCuisineClassifier {
        +classify(title, names, vocab) cuisineList
    }
    class StubCuisineClassifier {
        +classify(title, names, vocab) cuisineList
    }
    class FoodMatcher {
        +match(name) FoodMatch
    }

    CuisineClassifier <|.. LunaCuisineClassifier
    CuisineClassifier <|.. StubCuisineClassifier
    RecipeCategorizer --> FoodMatcher : FDC seed, reused
    RecipeCategorizer --> FdcCategoryMap : FDC group to facet value
    RecipeCategorizer --> RuleTagger : keyword rules
    RecipeCategorizer --> CuisineClassifier : LLM fallback
~~~

`FdcCategoryMap` is a small static map (FDC food group → `primary_ingredient` VOCAB value, or `null`
for non-ingredient groups like broths/sauces). `KEYWORD_DICT` is the RuleTagger's gazetteer, a
`const`. Both are code constants validated against `VOCAB`, not tables — same reasoning as `VOCAB`
itself.

~~~mermaid
flowchart LR
    A[categorizeStep] -->|recipes| B[RecipeCategorizer]
    B -->|ingredient name| C[FoodMatcher]
    C -->|FoodMatch category| B
    B -->|title and names| D[RuleTagger]
    D -->|FacetHits| B
    B -->|title, names, VOCAB| E[CuisineClassifier]
    E -->|cuisine values| B
    B -->|RecipeCategories| A
    A -->|enriched recipe| F[persistStep]
    F -->|recipe_categories rows| G[(libSQL)]
~~~

**New types.** `RecipeCategories = { cuisine: string[]; dishType: string[]; primaryIngredient: string[] }`.
It is attached to `ExtractedRecipeData` (a new optional `categories?` field, exactly as `estimate?`
was added for nutrition), so it flows through `toRecipeInput` → `RecipeInput` → `persistWith` with no
change to the workflow's control flow.

**Persist seam.** `toRecipeInput` gains a `categories` passthrough; `RecipeRepository.persistWith`
gains one `insertCategories(tx, recipeId, categories)` call alongside `insertIngredients` /
`insertSteps` — inside the same interactive transaction, so categories commit atomically with the
recipe. `findById` reads the rows and composes them back into the `categories` object (as it already
does for ingredients and steps).

`RuleTagger` is a curated keyword→facet dictionary (a "gazetteer" in NLP terms): a pure function, no
I/O, table-driven.

---

# APIs

No new endpoints. One field is added to the recipe read models so a client (and later the ranking
engine's own reads) can see the facets. Contract-level addition only.

## Get Recipe `GET /v1/recipes/:id`

Existing endpoint; the response `recipe` object gains `categories`.

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - recipe: object
        - id: string
        - title: string
        - …existing fields…
        - categories: object
            - cuisine: string[]
            - dish_type: string[]
            - primary_ingredient: string[]

`categories` is always present; each facet array is possibly empty. Values are vocabulary strings
(`"italian"`, `"pasta"`, `"seafood"`). The read model buckets the `recipe_categories` rows by facet
into one `categories` object at the boundary.

The library card (`RecipeCard`, `GET /v1/recipes`) is left unchanged for now; cards do not need
facets until the ranking UI does.

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| O-TS-01: Tiered categorization | Op | x | | |
| O-TS-02: Primary-ingredient dominance | Op | x | | |
| O-TS-03: FDC-seed matching (+ FdcCategoryMap) | Op | x | | |
| O-TS-04: RuleTagger keyword matching | Op | x | | |
| O-TS-05: Merge & assemble | Op | x | | |
| F-TS-01: Categorize during import | Flow | | x | |
| Persist categories (recipe_categories) | — | x | | |

## Test Approach

### Unit Tests

- **`RecipeCategorizer.categorize`** with a stub `FoodMatcher` (canned `FoodMatch.category`) and the
  `StubCuisineClassifier`. Assert: FDC "Finfish and Shellfish Products" → `primaryIngredient: [seafood]`;
  "Spaghetti Aglio e Olio" title → `dishType: [pasta]`; title dominance beats a body-only protein;
  every emitted value ∈ `VOCAB`.
- **`RuleTagger.tag`** — pure function, table-driven cases: title vs. body location, multi-label,
  no-hit. Assert "chicken" from an ingredient is a `BODY` hit, "shrimp" from the title is `TITLE`.
- **`FdcCategoryMap.toPrimaryIngredient`** — "Finfish and Shellfish Products" → seafood; broth/sauce
  groups → `null` (the guard that stops chicken-broth tagging poultry, O-TS-03 E4).
- **Merge & dominance (O-TS-02 / O-TS-05)** — the full Shrimp Scampi example resolves to
  `{italian, pasta, seafood}`; the `poultry` BODY hit is discarded.

Mock the LLM and FDC I/O; the vocabulary constant stays real. Per `server/CLAUDE.md`, don't test the
Zod parse or a stub returning its own constant.

### Integration Tests

- **`categorizeStep` in the import workflow** — mock the step's collaborators (unit-test the workflow
  by mocking its steps; never test WDK's replay). Assert the step runs after nutrition, attaches
  `categories`, and that a thrown categorizer yields an import that still reaches `ready` with empty
  category arrays (E1).
- **Persist** — against the local libSQL test db (migrated by `tests/helpers/global-setup.ts`): persist
  a recipe with categories, read it back via `findById`, assert the `recipe_categories` rows and the
  `GET /v1/recipes/:id` response shape. Assert replay idempotency (persist twice → no duplicate rows).
  Assert the `(facet, value)` reverse lookup returns the recipe.

### End-to-End Tests

Covered by the existing import e2e with the offline stubs selected (tests never hit the network): an
imported fixture recipe emerges with non-empty `categories`. No new e2e harness.

## Test Infrastructure

None new. Reuse the WI-1 FDC fixture (it already carries `category`) and the existing import fixtures.
Add a small `VOCAB` fixture only if the real vocabulary is large enough to make assertions noisy.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | `recipe_categories` table + its `(facet, value)` index (`drizzle-kit generate` → `migrate`) | yes |

Additive only — a new table, no change to `recipes`. Old code ignores it; the migration runs before
the code deploys with no coordination. No data migration: categorization applies to newly-imported
recipes going forward.

## Deploy Sequence

Single deploy. Migration first (additive), then the code that writes the table. Safe either way — the
table is new and unread until the code ships.

## Backfill (deferred, optional)

Existing recipes stay un-categorized until the ranking feature needs historical coverage. When it
does, run an **offline** one-shot that re-runs `RecipeCategorizer` over stored `recipes` +
`ingredients` and inserts rows — no workflow, no user-facing path. Trivial for rules/FDC (local, no
network); LLM-tier cost scales with the un-cued fraction (see Monitoring). Not built now — no consumer
yet.

## Rollback Plan

Code rolls back independently of the migration: the `recipe_categories` table is inert without the
writer, and `GET /v1/recipes/:id` tolerates its absence (categories default to empty). If the table
must go, drop it after the code rollback — nothing else references it.

---

# Monitoring

The categorize step emits **one structured log line per recipe**, mirroring `nutritionStep`'s line.
Metrics tie to F-TS-01 (is the signal being produced?) and to the LLM cost lever.

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| categorize_facet_coverage | histogram | F-TS-01 | facets filled per recipe (0–3); the signal's completeness |
| categorize_llm_fallback_rate | counter | F-TS-01 | recipes that reached the Luna tier; the cost driver |
| categorize_outcome_total | counter | F-TS-01 | labelled `ok` / `error`; best-effort failure rate |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| categorize_facet_coverage p50 = 0 sustained | 0 facets for 15 min of imports | warn |
| categorize_outcome error rate | > 20% over 1h | warn |

Neither pages — categorization is non-blocking enrichment; a regression degrades ranking quality, it
does not break import.

## Logging

One line per recipe at `info`, low-cardinality, carrying which tier filled each facet (the only place
provenance lives):
`[step] categorize job=<id> title=<t> cuisine=<n>(<tier>) dish=<n> primary=<n> outcome=<ok|error>`.
No per-facet-value logging in the hot path.

---

# Decisions

## Normalized `recipe_categories` table, not JSON columns on `recipes`

**Framework:** Direct criterion — the signal must be queryable by value.

The point of the signal is ranking retrieval: "give me the `seafood` recipes" — a filter *by value,
across rows*. A JSON array on `recipes` can't serve that in SQLite; a contained array element isn't
indexable, so the query degrades to a `json_each` scan of every recipe. A normalized child table with
a `(facet, value)` index turns it into a range scan returning `recipe_id`s. The JSON precedent
(`users.goals`, `recipeSources`) does **not** transfer — those are read back with the row and never
filtered by value; facets have the opposite access pattern.

**Choice:** `recipe_categories(recipe_id, facet, value)` with a composite PK and a `(facet, value)`
index — a normalized child table, matching `import_job_recipes` / `fdc_food_nutrient`.

### Alternatives Considered
- **JSON array columns on `recipes`:** rejected — matches the onboarding-array precedent and is cheaper
  to write, but is not queryable by value, which is the signal's primary consumer. Wrong access pattern.
- **Three per-facet tables:** rejected — 3× the surface, no benefit over a `facet` enum column.

## Controlled vocabulary as a code constant, not a DB table

**Framework:** Fermi ROI — effort vs. benefit.

A `VOCAB` table buys runtime editability we don't need pre-launch and costs a table, a cache, and a
validation round-trip per ingest. A `const` (seeded from Edamam's ~21 cuisines / ~24 dish types /
~12 primary-ingredient values) is ~zero effort, versions with the code, and is trivially testable.

**Choice:** `VOCAB` constant in code; the category arrays are validated against it before write.

### Alternatives Considered
- **`vocabulary` DB table**: rejected pre-launch — YAGNI; revisit if non-engineers must edit the list
  live.

### Documentation
- Edamam facet lists (vocabulary seed): https://developer.edamam.com/edamam-docs-recipe-api

## Reuse `FoodMatcher` for the primary-ingredient seed rather than a new ingredient→category map

**Framework:** Direct criterion — the mapping already exists.

`FoodMatch` already returns `category` (the FDC food group) for every ingredient the nutrition step
matches. Seeding `primary_ingredient` from it adds no FDC code and no second pass over ingredients we
already resolve. A hand-built ingredient→category dictionary would duplicate the FDC catalog.

**Choice:** Tier 1 reads `FoodMatch.category`; a small `FDC-group → facet-value` map (validated in
Q-02) is the only new lookup.

### Alternatives Considered
- **Bespoke ingredient keyword list for primary-ingredient**: partly retained (Tier 2 `RuleTagger`, for
  title-priority and dish_type) but not as the primary-ingredient source — the FDC catalog is more
  complete.

## LLM tier: OpenAI Luna (`gpt-5.6-luna`), constrained to `VOCAB`, cuisine-only fallback

**Framework:** Direct criterion — reuse the extractor's existing LLM tier.

Cuisine is the facet rules handle worst (~78–83% from ingredients; adjacent-cuisine confusion). The
codebase already integrates OpenAI `gpt-5.6-luna` via `ChatExtractor.openai()` (`OPENAI_API_KEY`,
JSON-mode chat completions) as the extractor's last-resort tier. The classifier reuses that seam —
same endpoint, model, key — with a classify-into-`VOCAB` prompt, invoked **only** when Tiers 1–2 leave
cuisine unresolved. This avoids introducing a second LLM provider (no Haiku/Anthropic dependency).

**Choice:** `LunaCuisineClassifier` over the existing OpenAI chat seam; unresolved-cuisine only; output
constrained to `VOCAB`; env-selected (`OPENAI_API_KEY`, in `.env`) with an offline stub.

### Alternatives Considered
- **Anthropic Haiku**: rejected — no key/access in this project; would add a new provider when the
  OpenAI tier already exists.
- **LLM for all facets, every recipe**: rejected — cost with no accuracy gain on FDC/rule-settled facets.
- **No LLM (rules only)**: viable Phase-2 state; rejected as the end state because cuisine coverage
  suffers most from the pure-rule ceiling.

### Documentation
- Reuses `server/src/parse/extractor.ts` `ChatExtractor.openai()` (`OPENAI_CHAT_URL`, `gpt-5.6-luna`).

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Exact `VOCAB` values per facet (needs product/founder sign-off). Seed from Edamam's lists? | open | |
| Q-02 | Does the FDC food-group → `primary_ingredient` map cover our values cleanly? "Cereal Grains and Pasta" conflates grains and pasta; "Finfish and Shellfish Products" → seafood is clean. Validate coverage against the seed catalog. | open | |
| Q-03 | Dominance rule for `primary_ingredient` — title-priority + highest-quality FDC match, or something stronger? We lack per-ingredient mass at ingest, so the spike's mass×rarity score isn't directly available. | open | |
| Q-04 | Luna cuisine accuracy + cost per call on a real sample of imported recipes before committing the tier. | open | |
| Q-05 | Should a facet array cap its length (e.g. ≤2 cuisines) to avoid over-tagging fusion dishes, or allow all matches plus a `fusion` value? | open | |

Q-01–Q-03 gate the categorizer's correctness and are referenced by O-TS-01 / O-TS-02. Q-04 gates
whether Tier 3 ships in the first cut or the feature launches rules-only.

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-17 | Backend Tech Lead | Initial draft — Direction B from the categorization spike. |
| 2026-08-17 | Backend Tech Lead | Review 1: LLM tier switched from Haiku to the existing OpenAI Luna seam; `Gazetteer` renamed `RuleTagger`. |
| 2026-08-17 | Backend Tech Lead | Review 2: kept the normalized `recipe_categories` table (queryable by value for ranking) — reverted the interim JSON-columns proposal, which had the wrong access pattern. |
| 2026-08-17 | Backend Tech Lead | Review 3: added detailed matching sequence diagrams (O-TS-03 FDC-seed match, O-TS-04 RuleTagger, O-TS-05 merge & dominance) with a worked Shrimp Scampi example; introduced `FdcCategoryMap`. |
