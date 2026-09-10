---
type: spec-plan
description: Plan for auditing and backfilling cuisine/dish_type coverage.
parent_spec: facet-coverage-backfill/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [facet-coverage-backfill spec](./spec.md).

## Approach

Reuse `RecipeCategorizer` end to end: a read-only audit first (so we know the gap size before spending LLM calls), then a targeted re-categorize that writes only missing rows.

## Phases

1. **Audit** — script that reports the three counts + gap lists.
2. **Backfill** — script that re-categorizes gap recipes and upserts missing facet rows, idempotent, low concurrency.
3. **Re-audit** — record residual gaps (recipes the analyzer still can't classify) as excluded from Tier 1 eligibility.

## Risks + unknowns

- Some recipes won't classify even with the LLM on (thin or odd content) — accept as residual, don't force a bad label.
- LLM cost/time if the gap is large — batch with low concurrency (the rate-limit lesson from ingest).

## Dependencies

- [split-course-facet](../split-course-facet/spec.md) merged first.
- `OPENAI_API_KEY` correctly configured — the original root cause of the gaps.

## Rollout

Offline scripts against Turso; no deploy, no migration. Pre-launch, run once (re-runnable).