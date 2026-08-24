---
tags: [harvest, ranking], tdd
summary: "Affinity v2 — sourcing recipes by taste, then ranking"
locked: false
---

# Affinity v2 — Sourcing Recipes by Taste

## Context & Problem

Affinity is the single most important ranking signal — people don't eat food they dislike — but
today it is modelled and placed in a way that wastes it.

**P1 — Affinity is a sparse bag-of-vocabulary match.** `AffinityScorer` (`server/src/ranking/scorers.ts:54`)
scores four facets (cuisine, dish_type, primary_ingredient, ingredient) as a hard `+1 / -1 / 0`,
means them, and maps to `[0,1]` via `0.5 + 0.5·mean`. Consequences, visible in the math:
- Any recipe the user has expressed no opinion on scores **exactly 0.5** — the untouched corpus is a
  flat wall, so "most recipes are equal" is the definition, not a tuning miss.
- Matches are binary and non-transitive: liking Thai green curry says *nothing* about Vietnamese
  lemongrass chicken (no shared vocabulary token), and "contains chicken" boosts a dish for a reason the
  user never meant.

**P2 — Affinity only scores; it does not source.** Ranking is filter → score → sort
(`ranking-engine.ts:13`) where affinity is **one of seven** weighted scorers that get *averaged* — a
fraction of the final number. Worse, it runs on a candidate set chosen without it: the deck is "all
visible recipes, optionally filtered by meal type" (`recipe-repository.ts:438`). The most important
signal is structurally the weakest and arrives after the shelf is already picked.

## Goals

1. Make affinity a **continuous, generalizing** signal: liking one dish should raise every
   culinarily-similar dish, not just token-identical ones.
2. Move affinity into **sourcing** — the deck is retrieved *by* affinity, then reranked by the existing
   seven scorers — so great matches can't be filtered out before they're seen.
3. Reuse what exists (FDC-matched base ingredients, the seven scorers, hard filters, swipes) and add the
   minimum: no new service, no vector database, no new runtime dependency.

## Non-Goals

- Replacing the seven rerank scorers or the hard filters (allergen/diet/equipment). They stay.
- Personalised *nutrition*/diet logic — unchanged.
- A literal typed knowledge graph. See D-01.

## Target Flows

No canonical use-case IDs exist for ranking yet (`docs/core-use-cases.md` covers auth + import only), so
this design names the flows it realises. They back the existing Discover/deck and swipe surfaces.

- **UCI-1 — Source the swipe deck by affinity** (realises `GET /v1/recipes/deck`).
- **UCI-2 — Update taste from a swipe** (realises `POST /v1/recipes/:id/swipe`).
- **UCI-3 — Build the taste space** (offline batch; precondition for UCI-1/2).

---

# Use Case Implementations

## UCI-1 — Source the swipe deck by affinity

~~~mermaid
%%{init: {'sequence': {'actorFontSize':16, 'noteFontSize':15, 'messageFontSize':14}}}%%
sequenceDiagram
    participant C as Client
    participant RS as RecipeService
    participant AR as AnchorResolver
    participant RT as DeckSourcer
    participant VS as TasteSpace
    participant RE as RankingEngine

    C->>RS: GET /v1/recipes/deck
    RS->>AR: anchors(userId)
    note over AR: swipes + stated likes → AnchorSet
    AR-->>RS: AnchorSet
    RS->>RT: source(anchors, K)
    RT->>VS: neighbours(anchor, k)
    VS-->>RT: nearest + cosine
    note over RT: walk + exploration slice
    RT-->>RS: candidateIds
    RS->>RE: rank(candidates, prefs)
    note over RE: hard filters + 7 scorers
    RE-->>RS: ranked cards
    RS-->>C: paged deck
~~~

**Phases**
- **Resolve anchors** — three typed sources feed one `AnchorSet`: (a) liked/saved **recipes** → their
  own vectors; (b) stated **facet-likes** in `user_food_prefs` → facet centroids ("italian" → the cuisine
  centroid, "burger" → the `dish_type` centroid, an ingredient-like → its direction / the recipes that
  carry it); (c) **dislikes** → repulsors. Onboarding-declared cuisines are just (b) captured early, so a
  user has anchors before their first swipe. Only when all three are empty does the deck cold-start to the
  current ranker (see Extensions).
- **Retrieve** — spreading-activation walk from the anchors over in-memory vectors; neighbourhoods around
  `dislikeAnchors` are suppressed; an ε slice is reserved for out-of-neighbourhood exploration.
- **Rerank** — hard filters (allergen/diet/equipment) then the seven scorers over the neighbourhood; the
  old `AffinityScorer` is retired in favour of retrieval-time affinity.

**Extensions**
- *No anchors (brand-new user: no swipes, no stated food prefs, no onboarding cuisine):* AnchorResolver returns empty →
  DeckSourcer falls back to today's behaviour (visible corpus, meal-type filter) so the deck degrades
  gracefully to the current ranker. See Q-06.
- *Neighbourhood smaller than K (thin corpus / narrow meal-type filter):* DeckSourcer relaxes to the full
  visible corpus, mirroring the existing `deck` fallback (`recipe-service.ts:131`).

## UCI-2 — Update taste from a swipe

~~~mermaid
sequenceDiagram
    participant C as Client
    participant RS as RecipeService
    participant SR as SwipeRepository
    participant AR as AnchorResolver

    C->>RS: POST /v1/recipes/:id/swipe {direction, reason?}
    RS->>SR: record(userId, recipeId, direction)
    note over RS: existing weight-tune / dislike-add path is unchanged
    RS->>AR: invalidate(userId)
    note over AR: anchors derived from swipes + stated food prefs on next deck request<br/>(recomputed or cache-invalidated, not stored eagerly — see Q-07)
    RS-->>C: 200
~~~

## UCI-3 — Build the taste space (offline)

Only the corpus-wide primitives are precomputed. IDF needs a full document-frequency pass and each
recipe vector needs the FDC join, so those are a real build step. Facet centroids are *not* built here —
they're cheap aggregates over the already-in-memory vectors, derived on the fly and cached (see D-09).

~~~mermaid
sequenceDiagram
    participant J as Batch job (npm script)
    participant DB as libSQL
    participant FB as RecipeTasteProfiler

    note over J,DB: precondition: recipes have FDC matches (re-seed / backfill — see Deployment)
    J->>FB: build()
    FB->>DB: read ingredients ⨝ fdc_foods.base_ingredient_id per recipe
    note over FB: document frequency per base ingredient → IDF<br/>recipe vector = IDF-weighted base-ingredient set (L2-normalised)
    FB->>DB: write ingredient_distinctiveness, recipe_taste_profiles
~~~

---

# Entities

~~~mermaid
classDiagram
    class Recipe {
        +string id
        +string[] baseIngredientIds
        +string[] cuisines
    }
    class RecipeTasteProfile {
        +string recipeId
        +float[] weights
    }
    class IngredientDistinctiveness {
        +string baseIngredientId
        +int documentFrequency
        +float idf
    }
    class FacetTasteProfile {
        +string facet
        +string value
        +float[] weights
    }
    class FoodPref {
        +string userId
        +string facet
        +string value
        +string sentiment
    }
    class Swipe {
        +string userId
        +string recipeId
        +string direction
    }
    class AnchorSet {
        +RecipeTasteProfile[] recipeAnchors
        +FacetTasteProfile[] facetAnchors
        +RecipeTasteProfile[] dislikeAnchors
    }

    Recipe "1" --> "1" RecipeTasteProfile : embeds as
    RecipeTasteProfile "*" --> "*" IngredientDistinctiveness : weighted by
    FacetTasteProfile "1" --> "*" RecipeTasteProfile : mean of
    AnchorSet "1" --> "*" Swipe : likes/saves → recipe anchors
    AnchorSet "1" --> "*" FoodPref : stated likes → facet anchors
~~~

An **anchor** is any point/region in ingredient space; the type reflects how it was produced:
a liked/saved **recipe** → its own vector; a stated **facet-like** (cuisine "italian", dish_type
"burger", primary_ingredient, or ingredient) → that facet value's centroid; a dislike → a repulsor.
`FacetTasteProfile` unifies them — the old "cuisine centroid" is just `facet='cuisine'`.

Resolving a facet-like to its recipes is a plain `recipe_categories` join on the categorizer's
write-time tag (`dish_type='burger'` → 36 recipes) — **not** title/text matching and **not** a recipe
embedding. The categorizer already did the semantic classification once at ingest; `title LIKE '%burger%'`
would both miss unnamed burgers (a "Juicy Lucy", a "smash patty") and false-positive "burger sauce". Stated
likes are controlled-vocab values by construction, so anchor resolution is a join with no query-time NLP.

---

# Tables

## recipe_taste_profiles

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| recipe_id | text | pk, fk → recipes.id | |
| weights | text (JSON) | not null | Sparse map `{baseIngredientId: idfWeight}`, L2-normalised. JSON, not `F32_BLOB` — we brute-force in memory (D-06), so no vector-index storage format is required. |
| built_at | int | not null | Epoch seconds; lets a re-seed detect staleness. |

## ingredient_distinctiveness

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| base_ingredient_id | text | pk, fk → taste_ingredients.id | |
| document_frequency | int | not null | # recipes containing it. |
| idf | real | not null | `ln(N / (1 + df))`. |

**No `facet_centroid` table.** A centroid is the mean of the vectors of recipes carrying a facet value —
a trivial aggregate over vectors that are already in memory (D-06), so it's derived on the fly and cached
per `(facet, value)`, never stored (D-09). This adds no table, no build step, and no staleness path.

A `FacetTasteProfile` is the plain mean of its facet's recipe profiles — uniform across cuisine,
dish_type, and primary_ingredient, with no per-cuisine prior (see D-07). Stated likes/dislikes already
live in `user_food_prefs` (facet + value + sentiment); `ingredients.fdc_id` / `recipe_categories` /
`recipe_swipes` also exist unchanged. Only `recipe_taste_profiles` and `ingredient_distinctiveness` are
new.

---

# Modules

~~~mermaid
classDiagram
    class RecipeTasteProfiler {
        +build() void
    }
    class TasteSpace {
        <<interface>>
        +neighbours(anchor, k) Neighbour[]
        +vector(recipeId) RecipeTasteProfile
    }
    class InMemoryTasteSpace {
        +neighbours(anchor, k) Neighbour[]
    }
    class FacetTasteProfileService {
        +tasteProfile(facet, value) FacetTasteProfile
    }
    class AnchorResolver {
        +anchors(userId) AnchorSet
    }
    class DeckSourcer {
        +source(AnchorSet, mealTypes, K) string[]
    }
    class RankingEngine {
        +rank(recipes, prefs) RankedRecipe[]
    }

    TasteSpace <|.. InMemoryTasteSpace
    AnchorResolver --> TasteSpace : recipe-anchor vectors
    AnchorResolver --> FacetTasteProfileService : stated facet-likes → centroids
    DeckSourcer --> TasteSpace : neighbours(), spreading activation
    FacetTasteProfileService --> TasteSpace : means over in-memory vectors (cached)
    RecipeService --> AnchorResolver
    RecipeService --> DeckSourcer
    RecipeService --> RankingEngine : rerank candidates
~~~

~~~mermaid
flowchart LR
    SW[recipe_swipes] -->|likes/saves/dislikes| AR[AnchorResolver]
    FP[user_food_prefs: cuisine/dish/ingredient likes] -->|facet anchors| AR
    AR -->|AnchorSet| RT[DeckSourcer]
    VS[(recipe_taste_profiles in memory)] -->|cosine neighbours| RT
    VS -->|facet means, cached| FCS[FacetTasteProfileService]
    FCS -->|centroid vectors| AR
    RT -->|candidateIds| RE[RankingEngine]
    RE -->|ranked cards| API[/v1/recipes/deck/]
~~~

The seven scorers, filters, and penalties are reused verbatim as the reranker. The old
`AffinityScorer` is **removed**; affinity now lives in retrieval. An optional
`distance-to-nearest-anchor` scorer may replace it as a soft tie-breaker (continuous, meaningful) —
decided by the eval, not assumed.

---

# APIs

## Source deck `GET /v1/recipes/deck`

Returns a ranked, affinity-anchored deck. **The public contract is unchanged** — this design swaps the
internal sourcing, not the request/response shape.

### Request

- Headers
    - authorization: `Bearer <jwt>`
- Query
    - categories: string[] (optional meal-type filter, unchanged)
    - page_token: string (optional, unchanged)

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - recipes: PublicRecipeCard[] (unchanged)
    - page_token: string | null
    - _debug.affinity: object (optional, dev-only) — `{ anchorRecipeId, cosine }` per card so we can
      show "because you liked X" and inspect the walk. Gated behind the same flag as the new path.

No new endpoints. Anchor rebuilds are internal to the existing swipe endpoint (UCI-2).

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| UCI-1: Source deck by affinity | Flow | x | x | |
| UCI-2: Update taste from swipe | Flow | | x | |
| UCI-3: Build the taste space | Op | x | | |
| Offline eval harness | — | x | | |

## Test Approach

### Unit Tests
- **RecipeTasteProfiler:** IDF math (`ln(N/(1+df))`), staple ubiquitous ingredients get ~0 weight, vectors
  L2-normalised.
- **FacetTasteProfileService:** a facet profile equals the hand-computed mean of its recipe profiles and is
  memoized (second call for the same `(facet, value)` hits the cache, doesn't recompute); a `dish_type`
  like "burger" resolves to a non-empty profile; a facet value with no tagged recipes returns empty
  (contributes no anchor).
- **DeckSourcer:** spreading activation sums overlapping neighbourhoods; a dislike anchor suppresses its
  neighbourhood; the exploration ε slice is present and deterministic (seeded, not `Math.random`).
- **InMemoryTasteSpace:** brute-force cosine top-k matches a reference implementation on a fixture.

### Integration Tests
- **UCI-1:** against a migrated local `file:` libSQL with a seeded fixture corpus, assert the deck for a
  user who liked one Thai recipe is dominated by culinarily-near recipes, and that an allergen hard
  filter still removes a matching-but-unsafe recipe.
- **UCI-2:** a like-swipe changes the next deck's ordering (anchor invalidation works).

### End-to-End
- Deferred until the eval clears the offline bar. Then a shadow-mode ramp (Deployment) is the real-world
  test.

## Test Infrastructure — the eval harness (first-class deliverable)

`npm run eval:affinity` — holds out each user's swipes, builds anchors from the remainder, and scores
whether retrieval ranks held-out **likes** above held-out **dislikes** (recall@k and AUC over
`recipe_swipes`). This is what tunes K, ε, the SVD trigger, and per-cuisine normalisation **empirically**
rather than by argument, and is the honest answer to "is this better than the 0.5 wall?" It reuses the
existing swipe data — no new labelling.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Add `recipe_taste_profiles`, `ingredient_distinctiveness` (additive) | yes |
| 2 | data | Backfill `ingredients.fdc_id` on the seed corpus (stale DBs have 0%; see Q-01). Reuse `seed:recipes` on a fresh DB, or a matcher-only backfill. | yes (additive) |
| 3 | data | Seed thin cuisines up to ~50–100 recipes each (~500–800 targeted); american is already 57% — do **not** add to the head. | yes |
| 4 | data | Offline `RecipeTasteProfiler.build()` — compute IDF + recipe vectors (centroids derive on the fly) | yes |

## Deploy Sequence

Schema (1) → backfill/seed (2,3) → taste-space build (4) → deploy code behind a flag. The new path is inert
until vectors exist, so 1–4 can run ahead of the code deploy.

## Rollback Plan

The new sourcing is behind a feature flag (shadow → ramp). Rollback = flag off → `RecipeService.deck`
takes the current corpus+meal-type path and the current seven-scorer average (old `AffinityScorer` kept
in the tree until the ramp completes). The additive tables are harmless if unused. No migration reversal
needed.

---

# Monitoring

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| deck_like_through_rate | histogram | UCI-1 | Likes ÷ cards shown — the real success metric vs the baseline ranker. |
| deck_source_mix | gauge | UCI-1 | Fraction of deck from neighbourhood vs exploration ε. |
| anchor_count | histogram | UCI-1 | Anchors per user; watches the multi-anchor assumption and cold-start prevalence. |
| coldstart_fallback_rate | counter | UCI-1 | Decks served with zero anchors (fell back to old path). |
| taste_profile_coverage | gauge | UCI-3 | % ingredients resolving to a base ingredient (vector density; ties to Q-01). |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| deck_like_through_rate drops below baseline during ramp | < baseline for 1h | page |
| coldstart_fallback_rate spikes | > 40% of decks | warn |

## Logging

Dev-only `_debug.affinity` provenance (anchor + cosine) at debug level, gated with the path flag. No
verbose logging in the retrieval hot path.

---

# Decisions

## D-01 — Embedding space, not a literal knowledge graph

**Framework:** Direct criterion (authoring cost vs behaviour parity).
A typed graph delivers the same "walk from one liked thing" behaviour only after you hand-author the
ontology and edges — which *is* the sparse-vocabulary problem moved up a layer. An implicit space learns
adjacency from data.
**Choice:** Embedding space. The graph's only unique win (crisp multi-hop explanations) is met well
enough by "because you liked X," a free by-product of nearest-neighbour.
### Alternatives Considered
- **Typed knowledge graph:** rejected — ontology authoring cost, new store, no behaviour gain.

## D-02 — Ingredient-IDF features, not text embeddings

**Framework:** Direct criterion (culinary validity + cost).
Text embeddings cluster by surface tokens: semantic distance ≠ culinary distance (chicken stir-fry near
chicken dessert). Base-ingredient vectors are grounded in the actual dish, already exist via FDC roll-up
(free), need no external model or privacy review, and are interpretable.
**Choice:** IDF-weighted base-ingredient vectors. IDF is mandatory — without it ubiquitous staples (salt,
oil) dominate cosine and rebuild the 0.5 wall.
### Alternatives Considered
- **Text/LLM embeddings for recipe distance:** rejected as the primary space (semantic≠culinary,
  external dep). Scoped to the ingredient vocabulary only — see D-08.
- **Collaborative filtering:** rejected for v1 — cold-starts badly at current swipe volume; revisit as a
  correction layer.

## D-03 — Sparse IDF-cosine v1; SVD as an eval-triggered upgrade

**Framework:** Fermi ROI.
IDF works at any scale and the corpus (3,527 recipes) supports it now. SVD's value is confined to the
well-covered head: only ~8 cuisines exceed 100 recipes; the tail (spanish 15, south_american 9, nordic 1)
yields noise factors. SVD effort (offline decompose, `k` tuning, dense store) buys little until the tail
is seeded.
**Choice:** Ship sparse IDF-cosine; add SVD only if the eval shows cousin-ingredient blindness capping
recall. SVD fixes that specific gap by folding co-occurring ingredients onto shared axes so their dot
product stops being zero.
### Alternatives Considered
- **SVD in the spine day one:** rejected — data too skewed to justify the machinery yet.

## D-04 — Affinity drives retrieval, not scoring

**Framework:** Direct criterion (signal importance vs placement).
Affinity is the top signal but today is 1/7 of an average over a candidate set chosen without it. A
bigger weight still can't recover recipes the sourcing never surfaced.
**Choice:** Deck = affinity neighbourhood + exploration; the seven scorers rerank within it.
### Alternatives Considered
- **Keep affinity as a scorer, just up-weight + pre-filter:** rejected — leaves P2 (throws away
  never-sourced matches) unfixed.

## D-05 — Multi-anchor + query expansion, not a single taste centroid

**Framework:** Direct criterion (avoid midpoint collapse).
Mean-pooling a user's likes into one vector maps "loves fiery Thai + hearty Italian" to a bland midpoint
matching neither — P1 reborn. Instead, anchors are **typed** and each seeds the walk independently: a
liked *recipe* is a point anchor; a stated *facet-like* (cuisine "italian", dish_type "burger",
primary_ingredient, ingredient) is a `FacetTasteProfile` anchor — the centroid of recipes carrying that value;
a single ingredient-like expands to the several facet centroids where it's characteristic. Stated
preferences are therefore first-class affinity, not just cold-start filler.
**Choice:** Per-anchor spreading activation over a set of typed anchors (recipe-point + facet-centroid);
no global taste centroid.

## D-06 — Brute-force in-memory cosine, no vector index

**Framework:** Fermi ROI.
3,527 recipes × ~100–600 sparse dims is a trivial dot-product scan (sub-millisecond). A libSQL vector
index / `vector_top_k` is real infra and a dependency on an API surface we'd have to pin.
**Choice:** Load vectors, scan in-process. Upgrade to a native vector index only when the corpus
outgrows memory (documented ceiling, not now).
### Alternatives Considered
- **libSQL native vector index:** deferred — premature at this scale.

## D-07 — Uniform data-mean profiles; defer the thin-cuisine prior

**Framework:** Direct criterion (YAGNI — build the prior only if the gap actually hurts).
Data-driven profiles are trustworthy only above ~100 recipes/cuisine, and 7 of 19 cuisines are under ~45
(nordic n=1). A hand-authored staple-ingredient prior, blended by shrinkage, would prop those up. But we
already **seed the tail** (Deployment step 3), which fixes the same gap at the source, and a thin cuisine
with too few recipes simply yields a weak/empty anchor that degrades gracefully. Two mechanisms for one
problem is one too many for v1.
**Choice:** Every `FacetTasteProfile` is the plain mean of its recipe profiles — no prior, no `alpha`,
uniform across facets. **Add-back path:** if seeding doesn't close the thin-cuisine gap (watch it in the
eval), reintroduce a `CuisineStaples` prior + shrinkage blend — the design slots back in at
`FacetTasteProfileService` without touching anything downstream.
### Alternatives Considered
- **Hand-prior + shrinkage now:** rejected for v1 — redundant with seeding the tail; adds seed data and a
  blend path to maintain before we know the gap bites.

## D-08 — Semantic embeddings scoped to the ingredient vocabulary only

**Framework:** Direct criterion (contain the semantic≠culinary risk).
Semantic embeddings *do* add one thing co-occurrence can't: relating ingredient *names* that never
co-occur (cilantro/coriander synonyms, substitutions). But on recipe distance they reintroduce the very
failure we rejected in D-02.
**Choice:** If needed (Q-02), embed only the ~hundreds of ingredient names to expand anchors / collapse
synonyms. Recipe distance stays in the co-occurrence space. Future-work tier. Note this is **not** needed
to resolve a stated facet-like — those are controlled-vocab tags that join directly (see Entities); a
label embedding would only help resolve a *free-text* like that falls outside the categorizer vocab.

## D-09 — Derive facet centroids on the fly + cache, don't precompute or store

**Framework:** Fermi ROI.
A centroid is the mean of a tag's recipe vectors — and D-06 already holds every vector in memory, so the
computation is a sub-millisecond aggregate over data we have. Precomputing into a `facet_centroid` table
would add a table, a `buildCentroids` batch step, a deploy migration, and a staleness path (rebuild when
recipes change) — all to cache a value that's trivially cheap to derive. There are only tens of facet
values in play, so a per-`(facet, value)` memo (module scope, lifecycle-tied to the vector cache) makes
repeat lookups free.
**Choice:** `FacetTasteProfileService.tasteProfile(facet, value)` computes-and-memoizes from the in-memory
vectors; no stored table. `RecipeTasteProfiler` still precomputes the genuinely expensive primitives (IDF +
recipe vectors), since those need corpus-wide passes.
### Alternatives Considered
- **Precomputed `facet_centroid` table + offline build:** rejected — a table and batch step to store a
  cheap derived aggregate; only pays off if we stop holding vectors in memory (the D-06 upgrade path).

## D-10 — Domain-first naming: the code speaks "taste", not "KNN"

**Framework:** Direct criterion (screaming architecture — a name should reveal intent, not mechanism).
The first draft named the plumbing: `RecipeVector`, `IngredientIdf`, `FacetCentroid`, `VectorStore`,
`FeatureBuilder`, `Retriever`. A newcomer reading those learns we built a vector-KNN system, not that we
model *how a person likes food* — the actual product. The mechanism (IDF, cosine, centroids) is an
implementation detail of one capability.
**Choice:** Name every type, table, and module for the culinary concept, keeping the mechanism in a
parenthetical where it's defined. The ubiquitous language:

| Mechanism (was) | Intent (now) | What it means |
|---|---|---|
| `RecipeVector` / `recipe_vectors` | `RecipeTasteProfile` / `recipe_taste_profiles` | a recipe's position in taste space |
| `IngredientIdf` / `ingredient_idf` | `IngredientDistinctiveness` / `ingredient_distinctiveness` | how much an ingredient distinguishes a dish (IDF weight) |
| `VectorStore` | `TasteSpace` | recipes as points; `neighbours()` walks to culinarily-similar dishes |
| `FacetCentroid(Service)` | `FacetTasteProfile(Service)` | the typical taste of a cuisine/dish category (its recipes' centroid) |
| `Retriever` | `DeckSourcer` | sources the deck by walking taste space (the P2 fix, named) |
| `FeatureBuilder` | `RecipeTasteProfiler` | turns the corpus into taste profiles + distinctiveness |

`anchor` (a liked thing that seeds the walk) is coined domain language and stays. Code lives under a
capability-named module — `server/src/ranking/taste/` — not scattered by mechanism.
**Proof (testability litmus):** the use cases run without web/db/server — `TasteSpace`, `DeckSourcer`,
and the reused `RankingEngine` are plain classes over in-memory profiles; `AnchorResolver` takes plain
swipe/pref data. That independence is *why* the names can stay domain-pure: the mechanism sits at the edge.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Per-ingredient FDC match coverage after a fresh re-seed (= vector density)? Stale DBs are 0%; 62% of recipes have *computed* nutrition, so the matcher clearly resolves ≥1 ingredient widely, but per-ingredient rate is unmeasured. | open | Measure on first `LIMIT=100` re-seed. |
| Q-02 | Does the eval plateau from cousin-ingredient blindness enough to justify SVD, and at what `k`? Do we need the D-08 ingredient-name embeddings? | open | Driven by `eval:affinity` results. |
| Q-03 | Exploration ε — what fraction of the deck is out-of-neighbourhood, and how are those picks chosen (popular/novel/diverse)? | open | Tune via eval; default ~0.15. |
| Q-04 | Per-cuisine normalisation to counter american's 57% mass (z-score vs rank vs per-cuisine neighbourhood density)? Without it the recommender drifts "American, plus things." | open | |
| Q-05 | Anchor weighting — save > like, and recency decay? Or treat all likes equally in v1? | open | Start unweighted; revisit if eval wants it. |
| Q-06 | Cold-start with *no* signals at all — no swipes, no stated food prefs, no onboarding cuisine — fall back to popularity, or prompt for a cuisine? (Stated likes now cover most new users, so this is the rarer true-zero case.) | open | v1: fall back to current ranker path. |
| Q-07 | Where are user anchors computed — request-time (recompute/cache) or a stored `user_anchors` table? Perf vs freshness. | open | Lean request-time + invalidate-on-swipe until profiling says otherwise. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-23 | Jordan Gaston | Initial draft — ingredient-space retrieval; affinity moves to sourcing. |
| 2026-08-23 | Jordan Gaston | Stated preferences are first-class typed anchors: generalised `CuisineCentroid` → `FacetTasteProfile` so cuisine/dish_type/ingredient likes each seed the walk. |
| 2026-08-23 | Jordan Gaston | Clarified facet-anchor resolution: a `recipe_categories` tag join (write-time categorization), not title/text matching or recipe embeddings. |
| 2026-08-23 | Jordan Gaston | Derive facet centroids on the fly + cache (D-09); dropped the `facet_centroid` table and `buildCentroids` step. |
| 2026-08-23 | Jordan Gaston | Screaming-architecture pass (D-10): renamed ML/IR plumbing to a domain-first "taste" vocabulary across types, tables, modules, and diagrams. |
| 2026-08-23 | Jordan Gaston | Removed the thin-cuisine prior for v1 (D-07 rewritten): facet profiles are a uniform data-mean; `CuisineStaples`/`alpha` dropped, seeding-the-tail covers the gap, add-back documented. |
