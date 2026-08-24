---
tags: [harvest, nutrition, ranking], tdd
summary: "Ingredient→food match accuracy — hybrid retrieval (RRF) design"
locked: false
---

# Ingredient→Food Match Accuracy — Design

## Context & Problem

The `FoodMatcher` (`server/src/nutrition/food-matcher.ts`) resolves a recipe ingredient name to an
FDC/FNDDS food. It backs **four subsystems**: nutrition, cost, diet classification, and the affinity
taste vectors. Today it does: `normalize(name)` → **trigram** FTS5 search → take the **top-1 by bm25** →
tier it (`high`/`medium`/`low`). There is **no validation** of the winner and **no second signal**.

Measured over the 14,948 distinct matched ingredient names in the corpus (proxy: a match whose food
description shares **no content word** with the ingredient is almost certainly wrong):

- **7.8% of matches are wrong** (1,170 / 14,948), and **essentially all are tiered `high`** (1,163) — the
  matcher is *confidently* wrong.

| Ingredient | Matched to | |
|---|---|---|
| cumin | Cucumber, raw | spice → vegetable |
| scallions | Scallops, fried | allium → **shellfish** |
| cherry tomatoes | Cherries, dried | vegetable → fruit |
| turmeric | Cheese, American | spice → dairy |
| fettuccine | Romaine lettuce | pasta → salad green |

**Root cause.** bm25 over character trigrams scores *spelling* overlap, not *food identity*. `cumin` and
`cucumber` share `cu…` trigrams, the wrong food wins the single ranked list, and there is no second
retriever to disagree and no gate to reject it. This is a **precision** problem: coverage is already high
(99.5% of ingredients match; 81% roll up to a base ingredient). A *missing* dimension is strictly better
than a *wrong* one — the sparse vectors, nutrition sums, and diet rules all tolerate gaps.

## Goals

- **G-01 — Precision.** Drive confidently-wrong matches from 7.8% to **< 2%** without cratering coverage.
- **G-02 — Meaningful confidence.** The accept/reject decision reflects agreement across signals, not a
  single trigram score.
- **G-03 — Measurable.** Every change is graded by an automated proxy + a labelled gold set, before/after.

## Use Case Implementations

### O-MATCH-01 — Match an ingredient name to a food

Replaces "top-1 bm25" with: multiple retrievers → **Reciprocal Rank Fusion** → reject floor.

~~~mermaid
sequenceDiagram
    participant C as Caller (nutrition/diet/taste)
    participant FM as FoodMatcher
    participant RT as Retrievers
    participant DB as fdc_foods FTS5
    participant RF as RrfFusion

    C->>FM: match(name)
    FM->>RT: search(tokens, K) per retriever
    RT->>DB: trigram FTS5 + word FTS5 (+ semantic)
    DB-->>RT: ranked candidate lists
    RT-->>FM: RankedCandidate[][]
    FM->>RF: fuse(lists)
    RF-->>FM: candidates by RRF score
    note over FM: accept top candidate only if it clears the reject floor<br/>(head-noun overlap AND min fused score) — else null
    FM-->>C: FoodMatch(source=fused) | null
~~~

**Extensions**
- *True food absent from FNDDS* (bucatini, pappardelle): fusion still returns something; the reject floor
  drops it → `null` rather than a wrong match. See Q-02.
- *Synonym the lexical retrievers miss* (scallion↔"green onion"): until the semantic retriever ships it
  fails the floor → `null` — an honest miss, not a wrong match.

## Entities

~~~mermaid
classDiagram
    class Ingredient {
        +string name
    }
    class FdcFood {
        +int fdcId
        +string description
        +string baseIngredientId
    }
    class RankedCandidate {
        +int fdcId
        +int rank
        +string retriever
    }
    class FoodMatch {
        +int fdcId
        +string source
        +string quality
    }
    Ingredient "1" --> "*" RankedCandidate : retrieved as
    RankedCandidate "*" --> "1" FdcFood : points to
    FoodMatch "1" --> "1" FdcFood : resolves to
~~~

## Tables

### Change to existing tables

Add a **word-tokenised** FTS5 mirror of `fdc_foods.description_normalized` (sibling to the current trigram
FTS index) so the word-level retriever can query exact words. Additive; no column changes.

### food_embeddings (new — semantic tier only, deferred)

Only if the eval still shows a tail after `{trigram, word}` (Q-04).

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| fdc_id | integer | pk, fk → fdc_foods.fdc_id | |
| vector | text (JSON) | not null | Food-name embedding; brute-forced in memory (small catalog, ~5.4k). |

## Modules

~~~mermaid
classDiagram
    class FoodMatcher {
        +match(name) FoodMatch
    }
    class Retriever {
        <<interface>>
        +search(tokens, k) RankedCandidate[]
    }
    class TrigramRetriever {
        +search(tokens, k) RankedCandidate[]
    }
    class WordRetriever {
        +search(tokens, k) RankedCandidate[]
    }
    class SemanticRetriever {
        +search(tokens, k) RankedCandidate[]
    }
    class RrfFusion {
        +fuse(lists) FusedCandidate[]
    }
    Retriever <|.. TrigramRetriever
    Retriever <|.. WordRetriever
    Retriever <|.. SemanticRetriever
    FoodMatcher --> Retriever : retrieve
    FoodMatcher --> RrfFusion : combine
~~~

~~~mermaid
flowchart LR
    N[ingredient name] --> RT[Retrievers: trigram / word / semantic]
    RT -->|ranked lists| RF[RrfFusion]
    RF -->|fused ranking| G[reject floor]
    G -->|clears| OUT[FoodMatch]
    G -->|below| NULL[no match]
~~~

## APIs

None. `FoodMatcher` is an internal collaborator; no HTTP contract changes.

## Testing

## Test Coverage

| Use Case | Type | Unit | Integration | Eval |
|---|---|---|---|---|
| O-MATCH-01: Match ingredient → food | Op | x | x | x |
| RrfFusion.fuse | Op | x | | |
| Reject floor | Op | x | | |

### Unit Tests
- **RrfFusion:** a candidate ranked well in two lists beats one ranked #1 in a single list (the
  cumin↔cucumber shape); deterministic on fixture lists.
- **Reject floor:** a fused top with no head-noun overlap → `null`; a real overlap → accepted.

### Integration Tests
- **O-MATCH-01** against a migrated `file:` libSQL with the seeded FNDDS catalog + both FTS indices:
  `cumin`, `scallions`, `cherry tomatoes`, `turmeric` resolve correctly or to `null`, never to the wrong
  food.

### Eval (test infrastructure — first-class)
- **Precision proxy** (`eval:matcher`): the zero-content-overlap script (exists). Regression gate; run
  before/after, target < 2%.
- **Gold set:** ~200 frequency-weighted ingredient names labelled with the correct base ingredient
  (LLM-draft + human review), kept in-repo. Measures true precision@1 (target > 95%).

## Deployment

### Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Add word-tokenised `fdc_foods` FTS mirror | yes |
| 2 | data | Re-run `backfill:fdc` (re-match all ingredients) | yes |
| 3 | data | Re-run `build:taste`, `reclassify:diets`, nutrition/cost re-enrichment | yes |

### Deploy Sequence

Its **own PR** — the matcher is shared, so this ships independently of the affinity feature. Schema (1) →
re-match (2) → re-enrich (3). No live traffic depends on ordering; the batches are offline.

### Rollback Plan

Behind a matcher-mode flag (`fused` vs legacy `top1`). Rollback = flip to `top1`; the additive FTS index
is inert. Stored matches from a bad run are corrected by re-running the backfill on the old mode.

## Monitoring

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| matcher_zero_overlap_rate | gauge | G-01 | % of matches with no content-word overlap (the precision proxy). |
| matcher_reject_rate | gauge | G-02 | % of ingredients that clear retrieval but fail the reject floor. |
| matcher_source_mix | gauge | O-MATCH-01 | fused / null share of matches. |
| base_ingredient_coverage | gauge | G-01 | % of ingredients rolling up to a base ingredient (guard against coverage collapse). |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| base_ingredient_coverage drops after a re-match | < 70% | warn |

## Logging

None in the hot path. The eval script logs the per-tier breakdown offline.

## Decisions

## D-01 — Hybrid retrieval fused by Reciprocal Rank Fusion, over guarded top-1

**Framework:** Fermi ROI.
The error is "one retriever wins with a spelling fluke." RRF combines several ranked lists by
`Σ 1/(k+rank)`, rewarding candidates that rank well across *multiple* retrievers and demoting single-list
flukes — using ranks, so bm25 and cosine never need score calibration. Impact: directly removes the
dominant failure class (~8%). Effort: low — RRF is rank arithmetic; the real work is the second retriever.
**Choice:** Fuse the retrievers with RRF. It's the standard, parameter-light hybrid-search combiner and a
strict superset of "pick the top bm25 hit."
### Alternatives Considered
- **Guarded top-1 bm25** (a hard overlap gate on the single list): rejects bad matches but can't *find* the
  right one when trigram mis-ranks it — RRF both finds it and gates it.
- **Weighted score fusion / learned reranker:** needs score calibration or training data; RRF is
  parameter-light and robust now.
### Documentation
- RRF: Cormack et al., "Reciprocal Rank Fusion outperforms Condorcet…" (2009).

## D-02 — Word-level retriever first; semantic only if needed

**Framework:** Fermi ROI.
RRF needs retrievers with *complementary* errors. A word-tokenised FTS5 index queried for `cumin` matches
the *word* "cumin" and will **never** return cucumber — exactly complementary to the trigram index, at
near-zero effort (a second FTS mirror + the same query path, no new dependency). It should clear most of
the ~8%. A semantic (embedding) retriever adds a third fused list for synonyms the lexical retrievers miss
(scallion↔"green onion") — but it's a new dependency and carries the semantic≠exact risk, so it earns its
place only if the eval still shows a tail (Q-04).
**Choice:** Ship `{trigram, word}` fused by RRF first; add the semantic retriever as a third list only when
measured to be needed.
### Alternatives Considered
- **Jump straight to embeddings:** higher ceiling but a dependency + the semantic≠exact risk; unnecessary
  to clear the bulk of the error.

## D-03 — Keep an explicit reject floor on the fused result

**Framework:** Direct criterion (fusion ranks; it can't reject).
RRF picks the best *available* candidate; when the true food isn't in FNDDS it still returns one. A floor
(head-noun overlap AND a minimum fused score) turns "best-but-wrong" into `null`.
**Choice:** Apply the floor to the fused top; a missing dimension beats a wrong one (G-01).

## D-04 — No alias table (deferred as an optimization)

**Framework:** Direct criterion (YAGNI).
A hand-authored `ingredient → base` alias table would be precision-1.0 for the frequent head, but it's a
new table, a curated seed, and ongoing upkeep — machinery the retrieval fix may make unnecessary. Common
ingredients (salt, garlic, onion) already match trivially by word.
**Choice:** Fix the *retrieval*, not the *data*. Revisit aliases only if the eval shows a stubborn
frequent-ingredient miss, or if latency ever wants the hot head pinned — an optimization, not core.

## D-05 — Two repo methods + a fusion function, not a `Retriever` interface (implementation)

**Framework:** Direct criterion (YAGNI).
The Modules diagram shows a `Retriever` interface with three implementations. As built (increment 1),
that's `FdcFoodRepository.searchTrigrams` / `searchWords` + a pure `rrfFuse` — an interface with two
implementations is speculative machinery.
**Choice:** Ship the two methods + `rrfFuse`. The `Retriever` interface earns its place when the third
retriever (semantic) lands; extracting it then is mechanical.

## Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | RRF `k` (rank constant) and per-retriever weights — tune on the gold set? Default `k=60`. | open | Tune via `eval:matcher`. |
| Q-02 | Reject-floor threshold — head-noun overlap alone, or also a min fused score? What coverage cost? | open | Sweep on the gold set; watch base_ingredient_coverage. |
| Q-03 | Gold-set size/labelling — 200 enough? LLM-draft acceptable for labels, or full human review? | open | |
| Q-04 | Does the eval still show a tail after `{trigram, word}` that justifies the semantic tier? | open | Decided by increment-1 results. |

## Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-24 | Jordan Gaston | Initial draft — hybrid retrieval (RRF) over guarded top-1. |
| 2026-08-24 | Jordan Gaston | Dropped the alias table from the core; word-level retriever first, semantic if needed, aliases deferred as an optimization. |
