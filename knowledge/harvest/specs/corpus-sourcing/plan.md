---
type: spec-plan
description: Plan for measuring corpus density, sourcing, and QA before the embedding build.
parent_spec: corpus-sourcing/spec
created: 2026-09-11
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [corpus-sourcing spec](./spec.md).

## Approach

Measure first — the density rule is the real gate, and a read-only measurement decides whether sourcing is even needed. Source only if the rule fails or to firm the rare tail; QA any new recipes before they enter the corpus. Coverage beats count.

## Phases

1. **Measure** ✅ *done.* `corpus:density` (`scripts/measure-corpus-density.ts`, branch `jordangaston/corpus-sourcing`) reports the per-ingredient rule + per-pair co-occurrence tail over `ingredientDistinctiveness` + taste profiles. **Result on the ~14.3k corpus: the rule PASSES** — the 200th-most-common base ingredient appears in **86** recipes (need ≥30); 289/563 ingredients clear df≥30; 4,936 pairs co-occur in ≥30 recipes.
2. **Source** (founder-directed, *optional* given the rule passes) — ingest vetted sources via the existing pipeline (`scripts/seed-recipes.ts`), shuffle + low concurrency to avoid bot-blocking. Its value now is firming the rare tail (189 ingredients still <df30) and cuisine coverage, not clearing the gate.
3. **QA + sign-off** — joint review of any newly-sourced sample (spread across cuisines, ingredients parse, facets categorize) before ingest; explicit sign-off.

## Risks + unknowns

- The headline rule passes, but the rare tail is still thin (189/563 ingredients under df30; only ~13% of co-occurring pairs reach ≥30). Sourcing helps the tail but is not gate-required.
- Popular-cuisine swamping — *coverage beats count*; 30k all-Italian would not help.
- Bot-blocking on ingest — shuffle + low concurrency (the seed lesson).

## Dependencies

- The categorizer (new recipes must categorize) and the taste pipeline (`ingredientDistinctiveness`, profiles) the measure reads.
- Blocks [embedding-recommender](../embedding-recommender/spec.md) — but the **gate is met**, so Phase 2 is unblocked pending founder sign-off.

## Rollout

Read-only measure (`corpus:density`); founder-directed ingest if pursued; no deploy, no migration.
