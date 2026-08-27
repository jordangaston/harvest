# Affinity v2 — Work-Item Specs

Decomposition of `design.md` into implementable tickets. All implemented this sprint — see
`../SPRINT-REPORT.md`. Each spec: goal · acceptance criteria · files · tests.

---

## WI-1 — Taste-profile data pipeline  ✅

**Goal.** Give every recipe a taste profile: back-fill `fdc_id`, then build IDF + per-recipe vectors.

**Acceptance criteria**
- Migration adds `recipe_taste_profiles(recipe_id pk, weights json, built_at)` and
  `ingredient_distinctiveness(base_ingredient_id pk, document_frequency, idf)`.
- `backfill:fdc` sets `ingredients.fdc_id`/`match_quality` via the ingest `FoodMatcher` (offline, no
  network/LLM); reports coverage.
- `build:taste` computes `idf = max(0, ln(N/(1+df)))` per base ingredient and each recipe's
  L2-normalized sparse profile; idempotent.
- Verify: cuisine centroids read culinarily (thai → fish sauce/coconut/lime).

**Files.** `schema.ts`, migration `0021`, `scripts/backfill-fdc-matches.ts`, `scripts/build-taste-space.ts`.
**Result.** 99.5% fdc coverage · 81% roll up to a base ingredient · 3,526 profiles · 379 dims.

---

## WI-3 — TasteSpace + the walk  ✅

**Goal.** Recipes as in-memory points; source a deck by walking from a user's anchors.

**Acceptance criteria**
- `cosine`/`centroid`/`normalize` over sparse profiles (pure, self-checked).
- `TasteSpace.source(anchorSet, candidateIds, k)` = Σ `weight·cosine(anchor,c)` − `max cosine(dislike,c)`;
  returns top neighbourhood + a deterministic exploration slice, or `null` when no anchors.
- No RNG (seeded/deterministic). Pure over in-memory data — unit-testable without db/web.

**Files.** `src/ranking/taste/{taste-profile,taste-space}.ts`. **Tests.** `test/taste-space.test.ts`.

---

## WI-4 — FacetTasteProfileService + AnchorResolver  ✅

**Goal.** Resolve stated likes + swipes into typed anchors.

**Acceptance criteria**
- `FacetTasteProfileService.tasteProfile(facet,value)` = centroid of the facet's tagged recipes
  (`recipe_categories` join, **not** title/text matching); `ingredient` → unit direction; memoized (D-09).
- `AnchorResolver.anchors(userId)` merges `recipe_swipes` (like/save → anchors, dislike → repulsors) and
  `user_food_prefs` (facet likes → facet centroids) into one `AnchorSet`.

**Files.** `src/ranking/taste/{facet-taste-profile-service,anchor-resolver,taste-repository}.ts`.
**Tests.** covered in `test/taste-space.test.ts` (stub repo).

---

## WI-5 — DeckSourcer + wire into the deck  ✅

**Goal.** Make affinity source the swipe deck.

**Acceptance criteria**
- `DeckSourcer.source(userId, candidateIds, k)` walks the space from resolved anchors; `null` → caller
  falls back to the current visible-corpus deck.
- `RecipeService.deck` sources an affinity neighbourhood, then `RankingEngine` reranks it (hard filters
  intact); no-anchor users unaffected.
- All existing tests still pass.

**Files.** `src/ranking/taste/{deck-sourcer,index}.ts`, `src/services/recipe-service.ts`.
**Deferred.** Retiring `AffinityScorer` (breaks its unit tests) — follow-up; sourcing is the real fix.

---

## WI-2 — recipes.json article filter  ✅

**Goal.** Drop non-recipes (roundups/guides/about pages) from the seed URL list before fetching.

**Acceptance criteria**
- `isRecipeSource({url,title})` drops URL patterns (`/pantry`, `-recipes$`, …) and roundup titles
  (leading number, "favorite", "guide", plural "recipes"); the JSON-LD `hasRecipe` check stays the final gate.
- Wired into `seed:recipes` URL loading.

**Files.** `src/parse/recipe-source-filter.ts`, `scripts/seed-recipes.ts`. **Tests.** `test/recipe-source-filter.test.ts`.

---

## WI-6 — Eval harness  ✅ (built; not iterated further, per request)

**Goal.** Quantify retrieval quality.

**Acceptance criteria**
- `eval:affinity` cuisine hold-out: anchor from half a cuisine, AUC/recall on the held-out half vs.
  off-cuisine. (Stand-in for held-out swipes until swipe volume exists.)

**Files.** `scripts/eval-affinity.ts`. **Result.** mean AUC **0.906** over 14 cuisines.
