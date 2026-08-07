---
tags: [harvest, cleanup, review]
summary: "Architect review of the Wave-1 Cleanup DESIGN.md — verdict, must-fix, open-question recommendations"
reviewer: Architect
---

# Architect Review — Cleanup (Wave 1)

Reviewed against live code in this worktree (paths spot-checked, not trusted from the doc).

## Verdict

**Approve with changes.** The shape is right and honours the binding conventions: `saved_recipes` and
copy-on-write go, ownership moves to `recipes.user_id`, onboarding becomes typed columns, and nutrition is
computed offline from a seeded USDA subset with the seed kept out of migrations. The must-fixes below are
concrete integration gaps, not a rearchitecture — land them before build; none needs founder re-litigation.

The one architectural weakness is C5/C5a match accuracy — a trigram over raw USDA descriptions will miss or
mis-match most generic ingredient names, and the water-density fallback can nearly double a staple's macros.
Both are containable with the changes below plus a coverage floor (Q-01).

---

## Must-fix (blocking)

### M1 · C3 — the `string[]` → `StructuredIngredient[]` change is not fully traced
The design says raw strings are parsed "at `toRecipeInput`." They cannot be. The JSON-LD family never reaches
the LLM — it is spread straight into `ExtractedRecipeData` at **five sites**: `import-pipeline.ts:91`
(website), `:124` (outbound link), `:211`/`:255` (IG/FB and TikTok outbound), and `:242`/`:247` (Pinterest
link and `pin.recipe`). By the time data reaches `toRecipeInput` (`:408`) it is already `ExtractedRecipeData` —
no raw strings survive to parse there.

Fix: move `parseIngredientLine` to the **`ExtractedRecipe` → `ExtractedRecipeData` boundary** — a single
adapter (e.g. `toExtractedData(structured)`) called at those five spread sites. That adapter is the real
convergence point, not `toRecipeInput`. Also name the two touch points the design omits:
- **`stripSectionLabels` (`import-pipeline.ts`) operates on `string[]`.** Once ingredients are structured it
  must filter on `.name` (or run on the raw lines *before* parsing). Today it silently won't compile.
- **`ExtractedRecipe.ingredients` (`fetch/website.ts:13`)** and `StubWebsiteFetcher.FIXTURE`
  (`website.ts:67`) are `string[]`. If you flip `ExtractedRecipe` itself to structured, `mapRecipe` must run
  the parser; if you keep it `string[]`, the adapter above must. Pick one and state it — the design implies
  both.

### M2 · C3 — the persist and edit paths still write name-only, dropping the new columns
`RecipeRepository.insertIngredients` (`recipe-repository.ts:118`) and `replaceIngredients` (`:264`) insert
`{ name, icon }` and never touch `amount`/`unit`/`quantity_text`. The design changes `RecipeInput.ingredients`
to `StructuredIngredient[]` but doesn't say these two methods must now persist the four columns. Spell it out.

More important: **the PATCH edit path regresses C3.** `updateRecipeSchema` (`api/schemas.ts:39`) takes
`ingredients: string[]`, and `replaceIngredients` re-inserts them name-only. A user who edits a recipe strips
its scalable amounts back to null. Either run `parseIngredientLine` on edited lines too, or note the
regression as accepted for v1. Silent is not an option — scaling is the whole point of C3.

### M3 · C5a — the matcher will miss or mis-match most generic names as specified
`search_name` is "the USDA description, lowercased and trimmed," trigram-matched. SR Legacy descriptions are
taxonomic: `"Garlic, raw"`, `"Cream, fluid, heavy whipping"`, `"Chicken, broilers or fryers, breast, meat
only, raw"`. A post-C3 ingredient name is `"heavy cream"` or `"garlic"`. Character-trigram similarity between
`"heavy cream"` and `"cream, fluid, heavy whipping"` is low (extra tokens and reordering tank it), while
`"cream"` trigram-matches `"ice cream"` and `"creamer"` — the classic fuzzy-match failure: it misses the real
food and confidently returns a wrong one.

Fix: canonicalize `search_name` to the **primary term** of the description (the first comma-segment, e.g.
`"garlic"`, `"cream"`), match on the ingredient's head noun, and keep a small hand-checked **alias list** for
the top cooking staples in the curated seed. This is why the seed must be curated, not the raw dump (Q-05).
Keep the trigram threshold conservative and lean on unmatched-and-log as the safety valve.

### M4 · C5 — bound the water-density fallback; it is dangerously wrong for dry volumes
Water density (1 ml = 1 g) applied to a **cup of flour** yields ~237 g against a real ~125 g — nearly double
the carbs and calories, on a calorie-dense staple, presented as `nutrition_source = 'computed'` (authoritative,
not null). Direction matters: it over-states, and it does so on exactly the ingredients that dominate a
recipe's macros (flour, sugar, rice, oats).

Fix, cheapest first:
1. Ensure the curated seed carries `food_portions` for the top volumetric dry goods so they hit the portion
   path, never the fallback.
2. Restrict the generic water-density fallback to genuinely water-like liquids (water, broth, milk, juice).
3. For a dry-goods volume with no portion, prefer **unmatched-and-log** over a water guess — an honest 0 that
   the coverage floor (Q-01) can catch beats a confident 2× overstatement.

### M5 · C5 — add a coverage floor, or `computed` will lie (this is Q-01)
"≥1 match → `computed`" means a recipe whose two missed items are the butter and sugar shows an absurdly low
calorie count labelled as computed fact. Gate `computed` on a **matched fraction** (see Q-01). Without it, M3
and M4 misses surface as confident understatements rather than an honest "unknown."

---

## Should-fix (recommended, non-blocking)

- **S1 · C2 — name the flush site for the mobile accumulator.** Verified: every onboarding screen holds its
  answer in local `useState` and only `router.push`es (`goals.tsx:19`, `age.tsx:11`, `cook-time.tsx:15-16`,
  etc.) — nothing is lifted or POSTed. The accumulator (`lib/onboarding.ts`) is correct. But Phone Auth
  (Wave 2) "creates the user at the end of onboarding," so **who owns the `POST /v1/users` call this sprint?**
  If it is Phone Auth's, Cleanup builds columns + accumulator and stops; if it is Cleanup's, say so. Otherwise
  you build an accumulator nothing drains, or two tasks build the POST.
- **S2 · C5 parsed path is under-specified.** `fetch/website.ts` does **not** parse `NutritionInformation`
  today (`mapRecipe:118` maps ingredients/yield/times/image only). The parsed path needs a new field on
  `ExtractedRecipe`, mapping in `mapRecipe`, and flow through `ExtractedRecipeData` → `toRecipeInput`. The
  test plan names the `mapRecipe` test but the Modules/Entities sections don't trace the field. Add it.
- **S3 · macro serialization.** pg `numeric` returns a string; the codebase already models this
  (`RecipeSchema.confidence` is `z.string().nullable()`, `PublicRecipe` `amount` is a string). Model the four
  new macros the same way (string-nullable), not as numbers — the design doesn't specify and the default
  guess would break the convention.
- **S4 · keep `parseIngredientLine` minimal.** The unit test table asks it to turn `"1 tbsp plus 1 tsp"` into
  `4 teaspoon` — that is deterministic unit-algebra plus "plus"-clause combining, i.e. re-implementing
  heb-bot's LLM prompt in regex. Don't. Parse the common case (leading amount/fraction + known-unit lookup +
  name); on anything ambiguous, set `amount/unit = null` and keep `quantityText = raw`. An unscalable line is
  honest; a wrongly-combined one is a bug. This is also the safer answer to Q-02.

## Nits

- **N1 · 404 vs 403 inconsistency.** The API section and the edit sequence diagram say non-owner → **404**
  (correct — don't leak existence); the Testing section says "owner-**403**." Make the test assert 404.
- **N2 · Delete the stale comment.** `recipes.ts:5-6` still says "ownership lives in `saved_recipes`." The
  design notes this — good; just confirming it is real.
- **N3 · `quantity_text` is a nullable column** (`ingredients.ts`), so the "never-null `quantity_text`" rule
  is a code invariant, not a DB one. Fine, but the guard lives only in `parseIngredientLine`/the adapter —
  keep it there for both paths.

## Verified (no action)

- **C6 child cascades are safe.** `ingredients`, `recipe_steps`, `cookbook_recipes`, and
  `import_job_recipes` all FK `recipes` with `onDelete: 'cascade'`. Owner-delete of the canonical row is
  clean — no FK error, no orphans.
- **C6 touch-point list is accurate.** `saveForUser`/`isSavedBy`/`updateContent` (CoW)/`removeForUser`/
  `countSavers`/`cloneRecipe`/`repointUser` all exist as mapped in `recipe-repository.ts`; `persist:82` calls
  `saveForUser`; `cookbook-repository.setMembership:120` inserts `savedRecipes`. Dropping them as designed is
  correct.
- **C1** is the one-line `href: null` on the `discover` tab (`app/(app)/_layout.tsx:53`). Correct; keep the
  screen file.
- **`StructuredIngredient` trimmed to a single `amount`/`unit`** (dropping heb-bot's `measurements[]` array)
  is the founder-sanctioned lossy call for the rare cross-system line — accepted, `quantity_text` preserves
  display.

---

## Open-question recommendations

| ID | Recommendation | Rationale |
|---|---|---|
| **Q-01** | **Yes — add a coverage floor.** Mark `computed` only when the matched fraction ≥ ~0.6 (by ingredient count); below it, `nutrition_source = null`. | A confident understatement is worse than "unknown"; this is what stops M3/M4 misses from shipping as fact. |
| **Q-02** | **Deterministic parser only** for the website path — but keep it minimal (S4). | Keeps the free Tier-0 path free; the null-and-preserve safety guard makes an added LLM call unnecessary. Revisit if website scaling quality complaints appear. |
| **Q-03** | **Defer `GET /v1/recipes`.** Build `listOwned` (tests use it), don't expose the endpoint. | No screen consumes an owned list this sprint — `app/(app)/recipes.tsx` lists cookbooks. YAGNI until Wave-2 Profile/Meal Planning needs it. |
| **Q-04** | **Accept flat `servings = 4` + the boolean.** | A weight-based heuristic needs the food catalog and is over-scoped for C4; scaling is pure multiplication. Honest flag now, upgrade if users complain. |
| **Q-05** | **Curated cooking subset**, not the ~7.8k dump. | A curated set is what lets you canonicalize `search_name` and hand-check aliases for the staples (M3) — the accuracy lever. Smaller committed seed is a bonus, not the point. |

---

## Risks

1. **C5/C5a match accuracy is the whole risk surface** (M3, M4). Even with the fixes, generic-name → USDA
   matching is inherently lossy; the coverage floor (Q-01) plus the unmatched log are what keep it honest.
   Treat computed macros as approximate and expect threshold/alias tuning post-seed.
2. **C3's type change ripples wide but is contained** (M1, M2). The five spread sites, `stripSectionLabels`,
   the two repository insert paths, both stubs, and every persist test move together — trace them as one unit
   or the build fails piecemeal.
3. **C2 scope seam with Phone Auth** (S1). Resolve POST ownership before build to avoid a half-wired signup.
4. **Migration 0006 assumes `recipes` is empty** (adds `user_id NOT NULL` with no default, drops
   `saved_recipes`). True pre-launch per founder; it will fail on any env that already holds recipe rows —
   acceptable, but call it out so a populated dev/staging DB is dropped, not debugged.
