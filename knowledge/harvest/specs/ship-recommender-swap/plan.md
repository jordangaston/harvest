---
type: spec-plan
description: Plan for cutting the production similarity core from IDF to the embedding recommender.
parent_spec: ship-recommender-swap/spec
created: 2026-09-15
author: jordangaston
tags:
  - spec
  - plan
---
Plan for [ship-recommender-swap spec](./spec.md).

## Approach

The production similarity core is **model-agnostic already**: everything reads recipe vectors from `recipe_taste_profiles` via `TasteRepository.allProfiles()` → `TasteSpace` (cosine/centroid), and the *only* request-path consumer is the swipe-deck sourcer (`recipe-service.ts` → `DeckSourcer` → `TasteSpace.source`). The affinity *scorer* uses `recipe.baseIngredientIds` directly, not the profile vectors, so it is untouched.

So the swap is **a build-script change, not a wiring change**: repopulate `recipe_taste_profiles` with the [embedding](../embedding-recommender/spec.md) recipe vectors instead of IDF profiles. The vectors are dense `number[250]`, stored as a `{ "0": v0, … "249": v249 }` weight map — `WeightsSchema` accepts any string→number map, and `TasteSpace` cosine over two dense maps is the exact dot product (= cosine, vectors are L2-normalized). `DeckSourcer`, `AnchorResolver`, `FacetTasteProfileService`, and `recipe-service` need **zero** changes; user anchors (swipe profiles + facet centroids) all resolve in the embedding space consistently.

## Gate (met)

The eval says ship: the plain-mean embedding wins Tier 1 (triplet 0.93) **and** the reusability-corrected, human-calibrated Tier 2 (`realtop` concordance 0.747 vs IDF 0.548; P@10 0.775 vs 0.660), Tier 1↔Tier 2 Spearman = 1.0, and the rare-ingredient regression probe stays low (0.017 ≪ 0.174).

## Phases

1. **Build** — `scripts/build-embedding-space.ts` (`build:embedding`): source base ingredients (`ingredients` → `fdc_foods.base_ingredient_id`) + cuisine/dish pseudo-tokens (`recipe_categories`), build the embedding, and write each recipe's vector to `recipe_taste_profiles` (truncate + rebuild, idempotent). This retires the IDF profile build for production.
2. **Serve** — no code change; the deck sourcer now serves embedding affinity.
3. **Verify** — profiles are dense 250-dim; `TasteSpace.source` reproduces the embedding's neighbors; suite green.

## Risks + unknowns

- **Eval baseline coupling.** Post-swap, `recipe_taste_profiles` holds embeddings, so the eval's table-read IDF baseline is no longer IDF — this is *intended* (IDF retired). Re-run the comparison only after rebuilding IDF via `build:taste`.
- **Item-item vs user-centroid.** The eval validated item-item similarity; production sources from a *centroid* of the user's likes. Same vector space, so it should transfer — but the true confirmation is an **online A/B** (Tier 3), per the [eval methodology](../../guides/recsys-eval-methodology.md).
- **Prod deploy is separate + founder-gated** — running `build:embedding` against Turso is the real cutover; do it deliberately.

## Rollout

Run `build:embedding` (local first, then prod). Rollback = re-run `build:taste` (rebuilds IDF profiles). Keep the Tier 3 behavioral slot open for online validation.
