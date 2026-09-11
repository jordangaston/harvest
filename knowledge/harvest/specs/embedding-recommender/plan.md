---
type: spec-plan
description: Plan for the PMI→SVD→SIF embedding recommender behind the rank interface.
parent_spec: embedding-recommender/spec
created: 2026-09-11
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [embedding-recommender spec](./spec.md).

## Approach

Build the embedding space offline, hold it in memory behind the [eval-harness-core](../eval-harness-core/spec.md) `rank(recipeId)` interface, and tune it against [tier1-metadata-eval](../tier1-metadata-eval/spec.md) until it beats IDF. No production persistence yet — that's [ship-recommender-swap](../ship-recommender-swap/spec.md). The corpus density gate is already met (see [corpus-sourcing](../corpus-sourcing/plan.md)).

## Key decision — SVD without a dependency

The PPMI matrix is small (~250 pruned ingredients + ~50 cuisine + ~24 dish-form pseudo-tokens ≈ **325×325**) and **symmetric** (PPMI(a,b)=PPMI(b,a)). So SVD reduces to a symmetric **eigendecomposition**, done with a hand-rolled **Jacobi rotation** solver (~60 lines, textbook-stable) — no new npm math dependency (the repo has none). Embedding = `Q_k · |Λ_k|^½` for the top-k eigenpairs by |λ| (PPMI isn't PSD, so rank by magnitude). Unit-tested against a matrix with known eigenpairs.

## Phases

1. **Co-occurrence + PPMI** — prune vocab (`df` < ~20–30 → reliable ~250); count pair co-occurrence over the pruned vocab **plus pseudo-tokens** (cuisine, dish form; base ingredient is the token itself); marginals from `ingredientDistinctiveness`. Build the symmetric PPMI matrix: `max(0, log(c_ab·N / (c_a·c_b)))`.
2. **Factor** — Jacobi eigendecomposition → top-k (~100) → per-token vectors.
3. **Pool (SIF)** — recipe vector = smooth-inverse-frequency weighted mean of its token vectors, minus the first principal component (the common component); L2-normalize.
4. **Interface** — `EmbeddingRecommender` implements `rankScored(recipeId, candidates)` via cosine over recipe vectors; registered alongside `idf`/`random` in the runner.
5. **Tune** — against Tier 1: prune threshold, SVD dims, pseudo-token weight, SIF `a`.

## Risks + unknowns

- **SVD correctness** — hand-rolled Jacobi must match a reference; test against a known-eigenpair matrix before trusting embeddings.
- **PPMI not PSD** — rank by |eigenvalue|, not signed.
- **Pseudo-token weight** — too high drowns ingredients; a tunable, judged on Tier 1.
- **Rare-ingredient probe direction** — the embedding should score *lower* than IDF here (it stops over-indexing on a single rare token) — that's the intended win, not a regression.

## Dependencies

- [eval-harness-core](../eval-harness-core/spec.md) (done), [tier1-metadata-eval](../tier1-metadata-eval/spec.md) (done), [corpus-sourcing](../corpus-sourcing/spec.md) density gate (met). No new npm dependency.

## Rollout

Offline build + in-memory eval (`eval:recsys`). No deploy; production wiring is Phase 4.
