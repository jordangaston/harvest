---
type: spec
description: Maximize cuisine/dish_type coverage by re-running the categorizer over gap recipes.
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: recommender-eval-harness
tags:
  - spec
  - categorization
  - eval
---
One-line: fill missing `cuisine` / `dish_type` facets so Tier 1 has the richest possible pool — by re-running the existing categorizer, not hand-labeling.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 0.2. Serves the [eval harness](../../proposals/recommender-eval-harness.md) Tier 1.*

## Goals

- Maximize coverage of `cuisine` and `dish_type` across the corpus — both are required for a recipe to be an eligible triplet anchor/candidate, so coverage is the ceiling on Tier 1 richness.
- Do it by re-running the existing `RecipeCategorizer` over only the gap recipes. No new classifier, no hand-labeling.

## Non-goals

- No change to categorizer logic or vocab — that's [split-course-facet](../split-course-facet/spec.md).
- Not sourcing new recipes — that's [corpus-sourcing](../corpus-sourcing/spec.md).
- No embedding or behavioral work.

## Design

Gaps exist because `RecipeCategorizer.analyze()` (`server/src/categorize/recipe-categorizer.ts`) degrades to *empty* facets on LLM failure — so they are recipes seeded or ingested while the analyzer was off or misconfigured (the known `OPENAI_API_KEY` mismatch that silently emptied `cuisine`). They are patchable, not missing data.

- **Audit** — count recipes with ≥1 `cuisine` row, ≥1 `dish_type` row, and both, from `recipe_categories`; emit the gap lists. The "both" count is the Tier 1 ceiling.
- **Backfill** — for each gap recipe, load title/ingredients/steps, run `RecipeCategorizer.analyze()`, and upsert only the *missing* `recipe_categories` rows. Never overwrite existing good rows. Idempotent — a re-run only fills what's still empty. Low concurrency (respect LLM rate limits).
- Runs as offline scripts against Turso, founder-runnable.

## Migration

None — this is a data fill, not a schema change. Must run *after* [split-course-facet](../split-course-facet/spec.md) so the categorizer writes clean `course` / `dish_type`.

## Test plan

- **audit** (integration): counts and gap lists correct against a seeded fixture.
- **backfill** (integration): fills a gap recipe's missing facet; leaves a fully-categorized recipe untouched.
- **idempotence**: a second backfill run is a no-op.
- Full suite green.