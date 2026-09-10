---
type: spec-tasks
description: Task checklist for facet coverage backfill.
parent_spec: facet-coverage-backfill/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [facet-coverage-backfill spec](./spec.md).

## Tasks

- [ ] `scripts/audit-facet-coverage.ts` — counts + gap lists for `cuisine`, `dish_type`, and both.
- [ ] `scripts/backfill-facets.ts` — re-run `RecipeCategorizer.analyze()` over gaps; upsert only missing `recipe_categories` rows; idempotent; low concurrency.
- [ ] Confirm `OPENAI_API_KEY` is set before running (the gap root cause).
- [ ] Re-audit; record residual gaps (excluded from Tier 1 eligibility).
- [ ] Tests: audit counts, backfill fills-only-missing, idempotence; full suite green.

## Done when

- Coverage of `cuisine` + `dish_type` is measured and maximized; residual gaps recorded.
- The backfill is idempotent and never overwrites good data.

## Out of scope

- Sourcing new recipes; categorizer/vocab changes.