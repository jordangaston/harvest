---
type: spec
description: Measure, source to ~30k, and QA the recipe corpus before the embedding build.
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: embedding-recipe-similarity
tags:
  - spec
  - data
  - recommendations
---
One-line: firm up the recipe corpus to the density the embedding model needs — measure, source to ~30k, QA together.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 1.5, a founder-gated blocker on [embedding-recommender](../embedding-recommender/spec.md). Grounded in the [embedding proposal](../../proposals/embedding-recipe-similarity.md) § Data requirements.*

> **Lean spec.** Full plan + tasks when Phase 1.5 begins — this is largely a founder-gated process, not a code build. Detailing it now would be speculative.

## Goals

- Get the corpus to co-occurrence density sufficient for PMI to converge — the rule: the ~200th-most-common ingredient still appears in 30+ recipes.
- Three steps, human in the loop: **measure** the distribution, **source** to ~30k (founder-directed, vetted sources), **QA together** (coverage spread across cuisines, ingredients parse, facets categorize).

## Non-goals

- Building the embedding model ([embedding-recommender](../embedding-recommender/spec.md)).
- Re-categorizing existing recipes ([facet-coverage-backfill](../facet-coverage-backfill/spec.md)).

## Design (sketch)

- **Measure** — a read-only script over `ingredients` / `ingredientDistinctiveness`: per-ingredient and per-pair recipe counts; report the gap to the density rule.
- **Source** — founder-directed ingest via the existing pipeline (`scripts/seed-recipes.ts`), shuffle + low concurrency to avoid bot-blocking; *coverage beats count*.
- **QA gate** — joint review of a sample before recipes enter the corpus; explicit sign-off.

*Exit:* the density rule holds on a quality-checked corpus.