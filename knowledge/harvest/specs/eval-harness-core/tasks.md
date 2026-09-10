---
type: spec-tasks
description: Task checklist for the eval harness core.
parent_spec: eval-harness-core/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [eval-harness-core spec](./spec.md).

## Tasks

- [ ] Define the `rank(recipeId) -> RecipeId[]` interface (scored variant for graded metrics).
- [ ] IDF recommender: wrap the existing `TasteSpace` cosine over `recipeTasteProfiles`.
- [ ] `random` and `popularity` baseline recommenders.
- [ ] `scripts/eval-recsys.ts` runner (`eval:recsys`): load `eval/gold/*`, score registered models, print headline + diagnostic table.
- [ ] Self-test asserting `random < popularity < IDF`.
- [ ] Confirm `recipes.popularity` is populated (else the popularity baseline is meaningless).
- [ ] Tests: self-test, interface determinism, runner output; full suite green.

## Done when

- Any recommender can be registered and scored through one interface.
- The baseline ordering holds and is asserted; the runner emits headline + diagnostics.

## Out of scope

- Triplet/gold-set content and metrics (the tier specs); the embedding model.