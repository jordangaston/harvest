---
type: spec-tasks
description: Task checklist for the production similarity-core swap.
parent_spec: ship-recommender-swap/spec
created: 2026-09-15
author: jordangaston
tags:
  - spec
  - tasks
---
Tasks for [ship-recommender-swap spec](./spec.md).

## Tasks

- [ ] `scripts/build-embedding-space.ts` (`build:embedding`): build the embedding from base ingredients + cuisine/dish pseudo-tokens and write recipe vectors to `recipe_taste_profiles` (truncate + rebuild).
- [ ] Confirm the request path (`recipe-service` deck sourcing) serves embedding affinity with no code change.
- [ ] Verify: profiles dense 250-dim; `TasteSpace.source` reproduces embedding neighbors; full suite green.
- [ ] Run `build:embedding` against local (swap dev); leave the prod Turso run as the deliberate, founder-gated cutover.
- [ ] (Follow-on) online A/B / interleaving validation — the Tier 3 behavioral slot.

## Done when

- `recipe_taste_profiles` holds embedding vectors, the swipe deck sources on them, and IDF similarity is retired from the production path. (Ship gate already green.)

## Out of scope

- The model + eval (own specs); behavioral / Tier 3 work (post-launch).
