---
type: spec-tasks
description: Task checklist for corpus density measurement, sourcing, and QA.
parent_spec: corpus-sourcing/spec
created: 2026-09-11
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [corpus-sourcing spec](./spec.md).

## Tasks

- [x] **Measure** — `corpus:density` (`scripts/measure-corpus-density.ts`): per-ingredient rule + per-pair co-occurrence tail, read-only. *Done — on the ~14.3k corpus the density rule **PASSES** (200th ingredient df=86 ≥ 30; 289/563 clear df≥30; 4,936 pairs ≥30). Unit-tested (`test/corpus-density.test.ts`).*
- [ ] **Founder decision (sign-off)** — the gate is met, so: proceed to Phase 2 (embedding-recommender) on the current corpus, **or** source to ~30k first to firm the rare tail + cuisine coverage. This is the open call.
- [ ] **Source** (only if pursued) — founder-directed vetted sources via `scripts/seed-recipes.ts`; shuffle + low concurrency; spread across cuisines.
- [ ] **QA gate** (if sourced) — joint sample review (coverage spread, ingredients parse, facets categorize) + explicit sign-off before ingest.
- [ ] Re-run `corpus:density` after any sourcing to confirm the tail improved.

## Done when

- The density rule holds on a quality-checked corpus with explicit sign-off. *(The rule already holds at ~14.3k; only the sign-off — and optional tail-sourcing — remain.)*

## Out of scope

- Building the embedding model ([embedding-recommender](../embedding-recommender/spec.md)); re-categorizing existing recipes ([facet-coverage-backfill](../facet-coverage-backfill/spec.md)).
