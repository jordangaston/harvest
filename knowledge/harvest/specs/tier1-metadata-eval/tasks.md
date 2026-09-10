---
type: spec-tasks
description: Task checklist for Tier 1 triplet eval and probes.
parent_spec: tier1-metadata-eval/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [tier1-metadata-eval spec](./spec.md).

## Tasks

- [ ] `scripts/build-eval-triplets.ts` (`labels:triplets`) — deterministic triplets (positive = cuisine ∩ dish_type; negative = shares neither) → `eval/gold/triplets.jsonl` with a seed header.
- [ ] Triplet-accuracy scorer wired into the harness runner.
- [ ] Rare-ingredient probe reusing `ingredientDistinctiveness.documentFrequency`; report per model relative to IDF.
- [ ] ~20 known-answer probe cases asserted in-repo.
- [ ] Tests: generation determinism + set logic, triplet accuracy, probe math, known-answer asserts; full suite green.

## Done when

- A committed triplet set scores triplet accuracy for every model through the harness.
- The rare-ingredient probe and known-answer probes run and are asserted.

## Out of scope

- Human labels (Tier 2); the embedding model; sourcing/coverage (own specs).