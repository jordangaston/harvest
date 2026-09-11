---
type: spec-tasks
description: Task checklist for the PMI→SVD→SIF embedding recommender.
parent_spec: embedding-recommender/spec
created: 2026-09-11
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [embedding-recommender spec](./spec.md).

## Tasks

- [ ] **Symmetric SVD** — Jacobi eigendecomposition helper (pure); unit-test against a matrix with known eigenpairs. No new dependency.
- [ ] **PPMI builder** — prune vocab by `df`; count pair co-occurrence over pruned ingredients + pseudo-tokens (cuisine, dish form); build the symmetric PPMI matrix from co-occurrence + marginals. Pure + tested on a fixture.
- [ ] **Token vectors** — top-k eigenpairs → `Q_k·|Λ_k|^½`.
- [ ] **SIF pooling** — recipe vector = SIF-weighted mean of token vectors minus the first PC; L2-normalize. Pure + tested.
- [ ] **EmbeddingRecommender** — implements `rankScored` (cosine over recipe vectors); registered in `scripts/eval-recsys.ts`.
- [ ] **Offline build script** — `scripts/build-embedding-space.ts` builds the space from the corpus (reuses the taste-space db read).
- [ ] **Tune + evaluate** — run triplet accuracy + rare-ingredient probe vs IDF; record the numbers; iterate prune/dims/pseudo-weight/SIF-a.
- [ ] Tests: SVD correctness, PPMI math, SIF pooling, recommender determinism; full suite green.

## Done when

- The embedding recommender plugs into `rank(recipeId)` and is scored by the harness.
- It **beats IDF on Tier 1 triplet accuracy** (> ~0.774) and its **rare-ingredient probe drops well below IDF's** (0.174) — the spec's exit criteria.

## Out of scope

- Eval infrastructure (harness/tier specs); corpus sourcing; production wiring ([ship-recommender-swap](../ship-recommender-swap/spec.md)).
