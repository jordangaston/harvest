---
type: spec-plan
description: Plan for Tier 1 triplet generation, scoring, and probes.
parent_spec: tier1-metadata-eval/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [tier1-metadata-eval spec](./spec.md).

## Approach

Generate a frozen triplet file once, then score it every run — the checked-in set is what makes numbers comparable over time. The probes are small additions to the same runner.

## Phases

1. **Generate** — the deterministic triplet builder → `eval/gold/triplets.jsonl`.
2. **Score** — triplet-accuracy scorer in the harness.
3. **Probes** — rare-ingredient probe (reuse `ingredientDistinctiveness`) + the known-answer assertions.

## Risks + unknowns

- `dish_type` still carrying role values would leak weak positives — [split-course-facet](../split-course-facet/spec.md) must land first.
- Thin coverage would shrink the set — [facet-coverage-backfill](../facet-coverage-backfill/spec.md) must run first.
- Popular cuisines could swamp the sample — the per-anchor cap mitigates it.

## Dependencies

- [split-course-facet](../split-course-facet/spec.md), [facet-coverage-backfill](../facet-coverage-backfill/spec.md), [eval-harness-core](../eval-harness-core/spec.md).

## Rollout

Offline; commit the generated triplet file. No deploy.