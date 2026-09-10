---
type: spec-plan
description: Implementation plan for splitting dish_type into course + form.
parent_spec: split-course-facet/spec
created: 2026-09-10
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [split-course-facet spec](./spec.md).

## Approach

A static, deterministic partition. The four role values are a fixed set, so both the code change and the data migration are mechanical — no content re-classification, no model calls. Ship vocab + schema + migration in one deploy so the enum and the data move together.

## Phases

1. **Schema + vocab** — add `course` to the facet enum (Drizzle migration) and the `course` allow-list; remove the role values from `dishType`; extend `RecipeCategories`.
2. **Producers** — categorizer routes role → `course`, form → `dishType`; verify `taste-classifier`.
3. **Consumers** — simplify `ranking/course.ts`; add `course` to `RankableRecipe`; fix any `dishType` role readers.
4. **Backfill** — the one-shot data move for existing rows.
5. **Verify** — unit + integration + full suite.

## Risks + unknowns

- A reader elsewhere keys off `dishType` role values (e.g. filters mains via `dishType`) and breaks silently — grep `main_course|side_dish|appetizer|dessert` across `server/src` before shipping.
- `dessert` is treated as a **course**; the sweet *forms* (`cookie`, `ice_cream`, `pie`, `pastry`) stay in `dishType`. A recipe may carry both.

## Dependencies

- Blocks [recommender-eval-harness](../../proposals/recommender-eval-harness.md) (Tier 1 triplets, course filter) and [embedding-recipe-similarity](../../proposals/embedding-recipe-similarity.md) (course-as-filter).
- No external dependencies; pure server + DB change.

## Rollout

Single migration + deploy. Pre-launch, so no feature flag or staged rollout; the backfill runs once against Turso.