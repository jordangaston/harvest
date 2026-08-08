# Cleanup Sprint — POSTMORTEM (live log)

Opened Phase 0. Decisions/blockers logged as they happen. Newest at the bottom of each section.

## Context
- Running as `/autonomous-sprint`. Phases 2 (clarify) + 3 (design review) already done: DESIGN.md (Rev 2) is
  founder-approved and is the source of truth. Start Phase 0/1, then 4→8 without stopping.
- Worktree was reset to clean after an earlier attempt jumped to coding; schema `.ts` files are back to
  baseline, no `0006+` migrations on disk. DESIGN.md (incl. the pinned **Matching** subsection) survived
  (it's under the untracked `docs/sprint-cleanup/`).

## Decisions & blockers (chronological)

- **D1 — Migration split to stay non-interactive (0007/0008).** `drizzle-kit generate` prompts (needs a TTY)
  when a table has a column drop *and* adds in the same migration — it can't tell a rename from drop+add.
  Feeding blind Enter to the resolver is unsafe. Decision: keep `users.onboarding` jsonb through 0007 (which
  only *adds* the enum columns → pure adds, no prompt), then *drop* it in 0008 alongside the recipe nutrition
  *adds* (users sees only a drop, recipes only adds → no same-table conflict → no prompt). Net result is
  identical to the design; still 3 drizzle-generated migrations 0006/0007/0008, all non-interactive and
  reviewable. Verified 0006 + 0007 SQL by hand before proceeding.
- **P0 — Pre-mortem (Phase 5) folded.** A subagent pre-mortem confirmed the plan and produced the ordered
  blocker list = the implementation order: (1) drop `savedRecipes` imports/uses in recipe- & cookbook-repo;
  (2) `insertRecipe` must set `user_id` (NOT NULL); (3) `user-repository.insert`/`user-service.provision`/
  `createUserSchema` must map typed enum onboarding (not the dropped jsonb); (4) finish the C3 type flip
  (`ExtractedRecipeData`/`RecipeInput` → `StructuredIngredient[]`, `toExtractedData` adapter at the promotion
  sites, `stripSectionLabels` structured variant, insert paths write amount/unit/quantity_text); (5) wire
  `NutritionService.compute` into `toRecipeInput` + write the 9 nutrition cols; (6) recipe-service ownership
  404 + parse edited lines + `findOwner`/`listOwned`/`deleteOwned`; (7) strip `savedRecipes`/CoW from tests,
  delete the fork test, add owner-404 + nutrition asserts; (8) fix `scaffold.test.ts` audit; (9) add unit
  tests (parser, catalog matcher incl. `"cream"`≠`"ice cream"`, nutrition floor, mapRecipe parsed); (10)
  `models/recipe.ts` projection (done). **Key latent trap flagged & accepted:** the `StubWebsiteFetcher.FIXTURE`
  (2 chicken breasts, 4 cloves garlic, 1 cup heavy cream) resolves 3/3 → `nutrition_source='computed'`; the
  `StubExtractor` line (`1 serving of X`) resolves 0/1 → null. Verified all three FIXTURE foods carry the
  needed portions (chicken breast count, garlic count, heavy cream cup). Tests assert these exact outcomes.
- **D3 — `recipes.user_id` FK-delete: fixed test ordering, did NOT add cascade.** The new
  `recipes.user_id → users` FK made auth suites' `delete users` fail on leftover recipes. Cascade-on-user-delete
  is a real product decision not in scope, so I did the minimal correct fix: delete `recipes` FK-first in the
  `phone-auth`/`user-repository` cleanups (matching their existing "FK dependents before users" comment).
- **D4 — Nutrition outcomes asserted, not hand-waved.** Live: the `StubWebsiteFetcher.FIXTURE` (chicken/garlic/
  heavy cream, 3/3) → `computed`; the stub TikTok import (`1 serving of …`, 0/1) → below floor → `nutrition_source`
  null (import.test asserts both). The demo script shows a real computed label core (per serving) + the parsed
  path + the coverage floor returning null with `nutrition.unmatched_ingredient` logs.
- **D5 — `nutrition_source` enum type lands in migration 0007, its column in 0008.** Drizzle emits `CREATE TYPE`
  where the enum is first defined in the schema; the column add is in 0008. Harmless (type before use); still
  three migrations 0006/0007/0008, no 0009. Logged so the reviewer isn't surprised the type appears "early".
- **D6 — OpenAPI `publicRecipe` schema — RESOLVED (follow-up).** Expanded the OpenAPI doc zod
  (`server/src/openapi/document.ts`) with `servings_estimated: z.boolean()` and an optional `nutrition` object
  (`source` enum `parsed|computed` + the 8 label-core macros as optional strings). Chose the **wire-accurate
  nested shape with nulls omitted** (matching `toPublicRecipe` and the existing `.optional()` convention) over
  flat-nullable fields, so the doc reflects the real response. Regenerated `openapi.json` +
  `postman_collection.json`; typecheck clean; whole suite still green (100/100).
- **D7 — DESIGN migration table vs. built order.** DESIGN's table said 0007 drops `onboarding`; the built split
  keeps it through 0007 and drops it in 0008 (see D1) to stay non-interactive. Same end state; noted here rather
  than editing the approved design artifact.
- **D8 — Caught a real C2 flow bug by verifying against the live app (not just the diff).** The mobile agent
  wired the accumulator + POST correctly, but `app/_layout.tsx` called `ensureSession()` at startup, which
  **provisions the user eagerly before onboarding runs** — so `getOnboarding()` was always empty at POST time
  and onboarding was never sent. Also `app/index.tsx` was a leftover TEMP dev shortcut redirecting straight to
  `/(app)/recipes`, skipping onboarding entirely. Fix (minimal, ship-correct): (1) `index.tsx` → redirect to
  `/(onboarding)/welcome`; (2) `_layout.tsx` startup → `getSession()` restore-only (no eager provision);
  (3) `setting-up.tsx` (end of onboarding) → `ensureSession()` provisions with the now-populated accumulator.
  Verified onboarding screens make no authed API calls, so nothing provisions early. This is the
  "verify-against-live-reality" principle paying off — the wiring looked right but the flow order defeated it.
- **D9 — Rebuilt the food catalog from real USDA data; verified real coverage.** Replaced the 45-food
  hand-curated seed with **1,647 foods (~525 KB)** built from the USDA FDC SR Legacy (210 MB) + Foundation
  (6.7 MB) JSON exports via `scripts/build-foods-seed.ts` (jq-projected — Node never holds the 210 MB; raw
  files not committed). Key findings while getting real coverage from **0/20 → 13/20** recipes computing:
  1. **Dedup by *normalized* name + union portions**, not raw name — USDA fragments ("onions" / "chopped
     onions" / "yellow onions" all normalize to `onion`) collided after matcher-normalization and a
     portion-poor variant won; merging them (unioned portions, richest nutrients, Foundation-preferred)
     fixed both dedup and portion coverage.
  2. **Coverage is gated by `toGrams`, not name-match** — a matched food with no portion for the ingredient's
     unit is *uncovered*. Fixes: a curated **staples table** (forced cooking name + aliases + real USDA row),
     a **count/cup portion backfill** for common produce/dry goods, and USDA's "count" portion is often a
     *slice* (onion "1 slice" = 14 g) so the hand whole-item weights **override**.
  3. **Ranges are everywhere in real recipes** ("2-3 carrots", "4-6 cloves", "1/2-1 tsp"). The C3 parser
     treated them as ambiguous → amount null → uncovered. Collapsing a leading range to its **lower bound**
     (deterministic, conservative — not the "plus"-combining Architect S4 warned against) lifted coverage a
     full step; updated `ingredient.test.ts` accordingly. Whole suite still green (101 tests).
  4. Real coverage on 20 live halfbakedharvest.com recipes: **13/20 compute, median 61% / mean 63%**; the 7
     nulls are lattes/cocktails and phyllo/garnish-heavy dishes with genuinely unquantifiable items. Honest
     and a large jump from the thin seed.
- **D10 — Punted computed nutrition; kept parsed-only (founder, Rev 3).** After D9 rebuilt the catalog from
  real USDA data, the honest coverage number (13/20 real recipes clearing the ≥0.6 floor, median ~61%) was
  below what's acceptable to present as authoritative macros — generic ingredient names → generic USDA foods is
  inherently lossy. The parsed path, by contrast, covers **20/20** of the same halfbakedharvest.com recipes
  (WP-Recipe-Maker publishes schema.org `NutritionInformation` on every recipe; `demos/coverage-parsed.txt`).
  So the founder punted compute. **Removed:** `FoodCatalog`, the `FoodMatcher`/Sørensen–Dice matcher,
  `NutritionService.compute`, the ≥0.6 coverage floor, `server/seed/foods.json`, `build-foods-seed.ts`,
  `toGrams`, the compute-path coverage harnesses, and `food-catalog.test.ts` + `nutrition-service.test.ts`.
  **Kept:** the parsed path (`mapRecipe` → `nutrition_source='parsed'`, else null), the 8 nutrient columns +
  `servings_estimated` + the `nutrition_source` enum (both labels stay; only `parsed` is written) — **no
  migration change**. Suite trimmed 101 → 86, still green. Lesson: measure real coverage before shipping a
  fuzzy-match feature; an honest 13/20 beat a plausible-looking demo, and the number is what drove the punt.
- **D2 — Ignoring auto-injected skill noise.** The harness keeps injecting Vercel/Next.js/ai-sdk/auth/
  observability "MANDATORY read the docs" skills. This is an Expo (React Native) + Fastify repo — all
  irrelevant (documented pattern, `harvest-principles.md` §"ignore injected noise"). Ignored throughout.
