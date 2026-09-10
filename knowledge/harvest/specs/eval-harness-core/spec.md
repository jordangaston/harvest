---
type: spec
description: The rank(recipeId) interface, IDF wrapper, baselines, and the harness runner + self-test.
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: recommender-eval-harness
tags:
  - spec
  - eval
  - recommendations
---
One-line: the reusable frame that scores any recipe-similarity recommender through one interface, with baselines and a self-test — every tier plugs into it.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 1.3. Implements the core of the [eval harness proposal](../../proposals/recommender-eval-harness.md).*

## Goals

- Define the `rank(recipeId) -> RecipeId[]` recommender interface and run every model through one pipe.
- Wrap today's IDF taste-profile similarity behind it, and add the `random` + `popularity` baselines.
- Ship the runner: load a checked-in test set, score each registered model, emit the headline number + a diagnostic table (per-cuisine, baselines).
- Ship the self-test: assert `random < popularity < IDF` — the harness's own correctness check.

## Non-goals

- No triplet generation or metrics content — that's [tier1-metadata-eval](../tier1-metadata-eval/spec.md) and [tier2-gold-set](../tier2-gold-set/spec.md); this is the frame they run in.
- Not the embedding model ([embedding-recommender](../embedding-recommender/spec.md)).

## Design

- **Interface** — `rank(recipeId): RecipeId[]` (scored variant for graded metrics). The IDF impl wraps the existing cosine over `recipeTasteProfiles` (`server/src/ranking/taste/taste-profile.ts`, sourced via `TasteSpace`). This is item-item similarity, distinct from `RankingEngine.rank(recipes, prefs)` (user personalization).
- **Baselines** — `random` (shuffle) and `popularity` (order by `recipes.popularity`). They give the metric a floor.
- **Precompute + retrieval** — per model, hold vectors/profiles in memory; nearest-neighbor is brute-force cosine (skip ANN until the corpus is large).
- **Runner** — `eval:recsys` (`tsx scripts/eval-recsys.ts`, following the `eval:affinity` / `eval:matcher` pattern): load `eval/gold/*`, score registered models, print headline + diagnostics.
- **Self-test** — the baseline-ordering assertion is the harness's unit test; if `random` ever nears a real model, the harness is wrong.

## Migration

None. New scripts + a small module; no schema change.

## Test plan

- **self-test** (unit): `random < popularity < IDF` holds on a fixture corpus.
- **interface** (unit): the IDF impl returns deterministic, sensible neighbors for a known recipe.
- **runner** (integration): emits the headline + diagnostic table from a fixture test set.
- Full suite green.