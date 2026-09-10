---
type: spec
description: Build the co-occurrence embedding recommender (PMI -> SVD -> SIF) behind the rank interface.
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: embedding-recipe-similarity
tags:
  - spec
  - ml
  - recommendations
---
One-line: the co-occurrence embedding recommender — PMI → SVD → SIF pooling → cosine — behind the same `rank(recipeId)` interface.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 2. Implements the [embedding proposal](../../proposals/embedding-recipe-similarity.md); iterates against [tier1-metadata-eval](../tier1-metadata-eval/spec.md).*

> **Lean spec.** Full plan + tasks when Phase 2 starts — it depends on the harness existing and the corpus being firmed up, and the design will sharpen against Tier 1.

## Goals

- Learn ingredient vectors from positive PMI over pair co-occurrence, factored by SVD (~100 dims).
- Pool into recipe vectors with SIF; fold **cuisine, dish form, and base** in as pseudo-tokens (course stays a retrieval filter); recommend by brute-force cosine.
- Implement the [eval-harness-core](../eval-harness-core/spec.md) `rank(recipeId)` interface so it's scored like any model.

## Non-goals

- Eval infrastructure (the harness/tier specs).
- Sourcing the corpus ([corpus-sourcing](../corpus-sourcing/spec.md)) — a prerequisite, not part of this.

## Design (sketch)

- Prune vocabulary (`df` < ~20–30) to the reliable core (~250 ingredients).
- **Pass 1:** count singles (already in `ingredientDistinctiveness`) + pair co-occurrence over the pruned vocab + pseudo-tokens.
- **Pass 2:** positive PMI = `max(0, log(c_ab · N / (count_a · count_b)))` → SVD → ingredient vectors.
- **Pool:** SIF (frequency-weighted average, subtract the common component) → recipe vectors; L2-normalize.
- Tunables (against the harness): prune threshold, SVD dims, pseudo-token weight.

*Exit:* beats IDF on Tier 1 and drops the rare-ingredient probe well below IDF's.