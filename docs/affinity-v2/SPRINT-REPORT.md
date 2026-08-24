# Affinity v2 — Overnight Sprint Report

**Status: working end-to-end, reviewed.** Affinity now drives *sourcing* on the real corpus (P2 fixed),
built on the ingredient-space taste model from `design.md`. All **416 server tests pass** (55 pre-existing
+ 15 new + 1 skipped pre-existing); typecheck clean. Passed a code-review + screaming-architecture pass —
findings applied (see "Review fixes").

## What shipped

| WI | What | Status |
|----|------|--------|
| WI-1 | `recipe_taste_profiles` + `ingredient_distinctiveness` tables (migration 0021); `fdc_id` backfill; taste-profile build | ✅ |
| WI-3 | `TasteSpace` — in-memory profiles, cosine, multi-anchor walk with dislike repulsors + exploration slice | ✅ |
| WI-4 | `FacetTasteProfileService` (on-the-fly memoized centroids) + `AnchorResolver` (swipes + food-prefs → AnchorSet) | ✅ |
| WI-5 | `DeckSourcer` wired into `RecipeService.deck` — affinity sources the deck, the scorers rerank | ✅ |
| WI-2 | `isRecipeSource` filter for `recipes.json` (roundups/guides/about pages dropped), wired into `seed:recipes` | ✅ |
| WI-6 | `eval:affinity` cuisine-hold-out harness | ✅ built (per request, not iterated further) |

## The data path (the overnight-critical decision)

The worktree started with **no deps, no dev DB, and `fdc_id` unset**. A full 4,629-URL reseed would be
hours of live fetches + LLM calls and flaky. Instead — **the sibling dev DB already held 3,527 fully
enriched recipes missing only `fdc_id`**, so:

1. Copied that enriched DB into `server/harvest-dev.db` (gitignored).
2. `npm run backfill:fdc` — reused the ingest `FoodMatcher` (offline trigram FTS5, no network/LLM).
   **99.5% of ingredient rows matched; 42,392 (~81%) roll up to a base ingredient** (~12 vector dims/recipe).
3. `npm run build:taste` — IDF over base ingredients + per-recipe L2-normalized profiles.
   **3,526 profiles, 379 distinct base-ingredient dimensions.**

The live-seed path (`recipes.json` → `seed:recipes`, now article-filtered) is built and correct for
fresh seeds, but is **not** how tonight's DB was populated.

## Evidence it works

**Demo** (`npm run demo:affinity`) — affinity-sourced decks on the real corpus:
- *Likes Italian* → 7 Italian + 2 Mediterranean (culinary neighbour) + 1 American — pasta/lasagna/ricotta.
- *Likes one Thai recipe* → coconut/chili/chicken neighbourhood surfaces first.
- *Likes Italian, dislikes Thai* → stays Italian-dominant, dislike reshapes the tail.

**Eval** (`npm run eval:affinity`, cuisine hold-out) — **mean AUC 0.906** over 14 cuisines
(chinese 0.982, thai 0.960, korean 0.971; american 0.757 broad-as-expected). The taste space strongly
separates same-cuisine from off-cuisine — the empirical answer to "better than the flat 0.5 wall?": yes.

## How to run

```bash
cd server
npm ci                       # deps (done)
# .env.local already points TURSO_DATABASE_URL at the enriched file DB
npm run backfill:fdc         # ~1 min — sets ingredients.fdc_id (already run)
npm run build:taste          # ~5 s  — builds taste profiles (already run)
npm test                     # 412 pass
npm run demo:affinity        # see affinity decks
```

## Review fixes (code-review + screaming-architecture)

- **Extracted `RecipeTasteProfiler`** — the IDF/profile math is now a pure, unit-tested class
  (`recipe-taste-profiler.ts` + test); `build-taste-space.ts` is a thin db adapter. Rebuild verified
  byte-identical (3,526 profiles). *(screaming-architecture: the profiling use case was script glue.)*
- **Profile-less candidates no longer vanish** — `TasteSpace.source` appends unscorable candidates
  (e.g. a freshly seeded recipe with no profile yet) to the deck tail instead of dropping them.
- **`cachedSpace` staleness** — added `resetTasteSpace()` and documented the rebuild→restart contract.
- **Removed the `as never` facet cast** — `recipeIdsByFacet` is typed to `CategoryFacet`; a bad facet is
  now a compile error, not a silent zero-row match.
- **Validate `weights` at the boundary** — `allProfiles` parses the JSON with Zod (`z.number().finite()`),
  per the parse-at-boundary convention, so a corrupt profile fails loud instead of poisoning cosine.
- Deleted unused `fromWeights` export.

## What's deliberately deferred (not blocking a working version)

- **Retire `AffinityScorer`** — left in the scorer list; retiring it broke its unit tests + engine
  breakdown tests. Affinity's real job (sourcing) is done; removing the weak scorer is a clean follow-up.
- **SVD, k-NN spreading-activation graph, per-cuisine normalization, semantic ingredient-vocab** —
  all future-work tiers per `design.md`; sparse IDF-cosine is the intended v1.
- **FDC-matcher noise** — a few odd rollups (e.g. "Vegan Mayonnaise" in the Italian centroid). The
  dominant signal is correct; matcher tuning is a separate concern.
- **`cachedSpace` auto-invalidation** — now has `resetTasteSpace()` + a documented restart contract; a
  TTL / `max(builtAt)` check (so a long-lived server self-refreshes after a rebuild) is a future upgrade.
- **Pure-dislike users** — a user who only dislikes (no likes) has no positive anchor, so `source`
  returns null and dislikes have no effect (anchor-gated design). Fine for v1; revisit if it matters.

## Key files

- Data: `server/scripts/{backfill-fdc-matches,build-taste-space}.ts`, migration `0021`.
- Feature: `server/src/ranking/taste/` (`taste-profile`, `taste-space`, `facet-taste-profile-service`,
  `anchor-resolver`, `deck-sourcer`, `index`, `taste-repository`).
- Wiring: `server/src/services/recipe-service.ts` (`deck`).
- Filter: `server/src/parse/recipe-source-filter.ts`.
- Tests: `server/test/{taste-space,recipe-source-filter}.test.ts`.
