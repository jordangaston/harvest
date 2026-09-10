---
type: spec
description: Cut the production recipe-similarity core over to the embedding recommender once it wins.
status: draft
owner: jordangaston
created: 2026-09-10
parent_proposal: embedding-recipe-similarity
tags:
  - spec
  - recommendations
---
One-line: cut the production recipe-similarity core over from IDF to the embedding recommender — once the harness says it's better.

*Part of the [Recommender Rebuild roadmap](../../guides/recommender-rebuild-roadmap.md) — Phase 4, the cutover.*

> **Lean spec.** Full plan + tasks when Phase 4 starts — it's a wiring swap gated on the eval outcome; premature detail would be speculative.

## Goals

- Wire the [embedding-recommender](../embedding-recommender/spec.md) as the production similarity core behind the existing interface; retire the IDF path.
- Ship only on a green gate: embeddings win Tier 1 **and** [Tier 2](../tier2-gold-set/spec.md), and the rare-ingredient regression probe is fixed.

## Non-goals

- Building the model or the eval (their own specs).
- Behavioral / Tier 3 work — a post-launch follow-on.

## Design (sketch)

- Swap the wiring behind the `rank(recipeId)` similarity interface; the personalized `RankingEngine` is untouched.
- Precompute + hold embedding recipe vectors where the taste profiles are held today.
- Keep the Tier 3 behavioral slot open for the post-launch online validation.

*Exit:* the embedding recommender serves production; IDF similarity is retired.