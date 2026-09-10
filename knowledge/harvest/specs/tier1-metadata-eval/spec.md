---
type: spec
description: "Tier 1: metadata triplets, triplet accuracy, rare-ingredient probe, known-answer probes."
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: recommender-eval-harness
tags:
  - spec
  - eval
  - recommendations
---
One-line: the free, instant, weak-label daily driver — triplets from cuisine + dish form, scored as triplet accuracy, plus the regression probes.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 1.4. Implements Tier 1 of the [eval harness proposal](../../proposals/recommender-eval-harness.md).*

## Goals

- Generate the Tier 1 triplet set (weak supervision from metadata) into a checked-in, versioned `eval/gold/triplets.jsonl`.
- Score **triplet accuracy** through the harness.
- Ship the **rare-ingredient probe** and the ~20 **known-answer probes**.

## Non-goals

- No human labels ([tier2-gold-set](../tier2-gold-set/spec.md)); no embedding model.
- Coverage is assumed done by [facet-coverage-backfill](../facet-coverage-backfill/spec.md).

## Design

- **Triplets** — `labels:triplets` (`tsx scripts/build-eval-triplets.ts`), deterministic (seed in the file header). Positive shares ≥1 value on **both** `cuisine` and `dish_type` (form); negative shares nothing on either. Cap per anchor, dedup, drop anchors with an empty pool. Two axes only — `primary_ingredient` and `course` are excluded (see the proposal).
- **Triplet accuracy** — fraction where `sim(anchor, positive) > sim(anchor, negative)`, run for every registered model via [eval-harness-core](../eval-harness-core/spec.md).
- **Rare-ingredient probe** — reuse `ingredientDistinctiveness.documentFrequency`; for anchors containing a low-`df` base ingredient, measure the fraction of the model's top-10 that share it; report per model, judged relative to IDF.
- **Known-answer probes** — ~20 asserted cases in-repo ("carbonara → pasta/Italian, never a smoothie").

## Migration

None. New scripts + a committed `eval/gold/triplets.jsonl`.

## Test plan

- **generation** (unit): determinism given a seed; positive/negative set logic; degenerate anchors dropped.
- **triplet accuracy** (unit): correct on a toy model with known orderings.
- **rare-ingredient probe** (unit): fraction math on a fixture; the `df` threshold selects the intended anchors.
- **known-answer probes**: the assertions pass on the real similarity.
- Full suite green.