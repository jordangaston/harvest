---
type: spec-plan
description: Plan for the eval harness frame, baselines, and runner.
parent_spec: eval-harness-core/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [eval-harness-core spec](./spec.md).

## Approach

Build the frame around the *existing* IDF similarity first — it's the reference model and the baseline-ordering self-test only needs it. The embedding model plugs into the same interface later without touching the harness.

## Phases

1. **Interface + IDF wrapper** — `rank(recipeId)` over the existing taste-profile cosine.
2. **Baselines** — `random` and `popularity`.
3. **Runner + diagnostics** — load `eval/gold/*`, score models, print headline + table.
4. **Self-test** — the baseline-ordering assertion.

## Risks + unknowns

- `recipes.popularity` may be sparse/unset — confirm it's populated, or the popularity baseline is meaningless.
- The IDF wrapper must reuse `TasteSpace`, not re-implement cosine — avoid two similarity code paths.

## Dependencies

- None hard — can start immediately (parallel to Phase 0). Only the `eval/gold/*` file *format* is shared with the tier specs.

## Rollout

Offline script; no deploy.