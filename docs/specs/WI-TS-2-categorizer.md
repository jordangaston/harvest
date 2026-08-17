# WI-TS-2 — Recipe categorizer (VOCAB, FdcCategoryMap, RuleTagger, CuisineClassifier, RecipeCategorizer)

## Background

The taste signal needs facet values *derived* for each recipe: `cuisine`, `dish_type`,
`primary_ingredient`. This work item builds the pure derivation logic — a `RecipeCategorizer` that
turns a recipe's title + ingredients into a `RecipeCategories` object — with no database writes and no
pipeline wiring (WI-TS-1 owns storage, WI-TS-3 owns wiring). It is unit-testable in isolation.

The design (`docs/design-recipe-categorization-signal.md`, ops O-TS-01..05) specifies a tiered match:

1. **FDC seed (O-TS-03).** Reuse the nutrition estimator's `FoodMatcher` verbatim
   (`server/src/nutrition/food-matcher.ts`): `FoodMatcher.match(name)` returns
   `{ fdcId, category, quality }`, where `category` is the FDC food group (e.g. "Finfish and
   Shellfish Products"). A new `FdcCategoryMap` maps that group to a `primary_ingredient` VOCAB value,
   or `null` for non-ingredient groups (broths, sauces, spices).
2. **RuleTagger (O-TS-04).** A pure function over a curated `KEYWORD_DICT`: scans the title and the
   ingredient names separately, tags each hit with its location (`TITLE` or `BODY`). Produces
   `dish_type`, plus `cuisine`/`primary_ingredient` for unambiguous keywords.
3. **CuisineClassifier (O-TS-01 tier 3).** Only when rules leave `cuisine` empty, call the LLM. Reuse
   the existing OpenAI seam the extractor already ships (`server/src/parse/extractor.ts`
   `ChatExtractor.openai()` — model `gpt-5.6-luna`, `OPENAI_API_KEY`, JSON mode), with a
   classify-into-VOCAB prompt. Offline stub for tests, selected by env like `selectExtractor()`.
4. **Merge + dominance (O-TS-02 / O-TS-05).** Assemble the final set: `dish_type` from rules;
   `primary_ingredient` by dominance (a `TITLE` rule hit wins outright, else the highest-quality FDC
   candidates, `BODY`-only hits discarded); `cuisine` from rules or the LLM. Validate every value
   against VOCAB and dedupe.

`VOCAB` is a controlled vocabulary — a code constant, three allow-lists (one per facet), revisable
without a migration. The starting seed is below (design Q-01, pending founder sign-off).

## Objective

Implement `RecipeCategorizer.create(db).categorize(title, ingredients): Promise<RecipeCategories>` and
its collaborators — `VOCAB`, `FdcCategoryMap`, `RuleTagger`, and a `CuisineClassifier` interface with
`LunaCuisineClassifier` + `StubCuisineClassifier` + a selector — producing VOCAB-valid, deduped
facets, with the dominance rule that resolves the shrimp-vs-chicken-broth case. No DB writes, no
pipeline changes, no network in tests.

**Seed `VOCAB`** (code constant; `snake_case` values):
- `cuisine` (~18): `american, british, caribbean, chinese, eastern_european, french, greek, indian,
  italian, japanese, korean, mediterranean, mexican, middle_eastern, southeast_asian, south_american,
  spanish, thai`
- `dish_type` (~16): `pasta, pizza, soup, stew, salad, sandwich, burger, taco, curry, stir_fry, bowl,
  casserole, bread, dessert, main_course, side_dish`
- `primary_ingredient` (~12): `seafood, poultry, beef, pork, lamb, egg, cheese, tofu, beans,
  vegetable, pasta, grain`

`[ASSUMPTION: exact VOCAB values are the design's proposed seed (Q-01), not yet founder-signed-off.
They live in one code constant so revising them is a code change, not a migration.]`

## Acceptance Criteria

1. **VOCAB constant.** Given `VOCAB`, when imported, then it exposes three readonly string arrays
   (`cuisine`, `dishType`, `primaryIngredient`) matching the seed, and a helper to test membership per
   facet. Every value the categorizer emits is a member of the corresponding list.
2. **FdcCategoryMap.** Given `FdcCategoryMap.toPrimaryIngredient(fdcGroup)`, when called with an FDC
   food group, then it returns a `primary_ingredient` VOCAB value for ingredient groups (e.g. "Finfish
   and Shellfish Products" → `seafood`, "Poultry Products" → `poultry`) and `null` for non-ingredient
   groups (e.g. "Soups, Sauces, and Gravies" → `null`).
3. **RuleTagger.** Given `RuleTagger.tag(title, ingredientNames)`, when called, then it returns
   `FacetHits` containing `dish_type` values, `cuisine` values, and `primary_ingredient` hits each
   annotated with location `TITLE` or `BODY`. A keyword found in the title is `TITLE`; one found only
   in an ingredient name is `BODY`. Unmatched tokens produce no hit. All values are VOCAB members.
4. **CuisineClassifier — Luna.** Given `LunaCuisineClassifier.classify(title, names, vocabCuisine)`,
   when invoked, then it calls the OpenAI seam (`gpt-5.6-luna`, `OPENAI_API_KEY`, JSON mode) with a
   prompt constraining output to `vocabCuisine`, and returns a `string[]` subset of `vocabCuisine`
   (empty if none). Non-VOCAB or malformed model output is dropped, not thrown.
5. **CuisineClassifier — stub + selector.** Given no `OPENAI_API_KEY`, when the classifier is
   selected, then `StubCuisineClassifier` is returned (deterministic, no network). Tests use the stub.
6. **Tiered categorize + dominance.** Given `categorize(title, ingredients)`, when run, then:
   a. `primary_ingredient` — a `TITLE` RuleTagger hit wins outright; absent that, the FDC-seeded
      candidates (highest `quality`, `null`-mapped groups already excluded) are used; a `BODY`-only
      rule hit never wins alone.
   b. `dish_type` — comes from RuleTagger only.
   c. `cuisine` — RuleTagger values if any; otherwise the CuisineClassifier is called with
      `VOCAB.cuisine`.
   d. The result is validated against VOCAB and deduped.
7. **Worked example resolves correctly.** Given title "Shrimp Scampi" and ingredients
   `["shrimp", "spaghetti", "garlic", "chicken broth"]` with the stub cuisine classifier returning
   `["italian"]`, when `categorize` runs, then the result is
   `{ cuisine: ["italian"], dishType: ["pasta"], primaryIngredient: ["seafood"] }` — `poultry` (a
   `BODY` hit from "chicken") is discarded, and "chicken broth" contributes no FDC candidate
   (`FdcCategoryMap` → `null`).
8. **No network in tests; no throw on empties.** Given a recipe that matches nothing, when `categorize`
   runs with the stub, then it returns `{ cuisine: [], dishType: [], primaryIngredient: [] }` without
   error and without any network call.

## Test Cases

### Test Case 1: VOCAB membership (AC1)

**Preconditions:** none.
**Steps:** Import `VOCAB`; assert lengths/values; assert the membership helper accepts a known value
and rejects an unknown one per facet.
**Expected Outcomes:** Arrays match the seed; membership helper behaves per facet.

### Test Case 2: FdcCategoryMap mapping and null (AC2)

**Preconditions:** none.
**Steps:** Call `toPrimaryIngredient` for "Finfish and Shellfish Products", "Poultry Products", "Beef
Products", and "Soups, Sauces, and Gravies".
**Expected Outcomes:** `seafood`, `poultry`, `beef`, `null` respectively. Every non-null result is a
`VOCAB.primaryIngredient` member.

### Test Case 3: RuleTagger location tagging (AC3)

**Preconditions:** none.
**Steps:** `tag("Shrimp Scampi", ["shrimp","spaghetti","garlic","chicken broth"])`.
**Expected Outcomes:** `dish_type` includes `pasta`; `primary_ingredient` hits include
`{ seafood, TITLE }` (from title "Shrimp") and `{ poultry, BODY }` (from ingredient "chicken");
"garlic" and "chicken broth" yield no cuisine/protein noise.

### Test Case 4: Dominance — shrimp scampi (AC6, AC7)

**Preconditions:** Stub `FoodMatcher` returning canned matches: "shrimp" → category "Finfish and
Shellfish Products" (high), "chicken broth" → "Soups, Sauces, and Gravies" (medium), others → null.
Stub cuisine classifier → `["italian"]`.
**Steps:** `categorize("Shrimp Scampi", [shrimp, spaghetti, garlic, chicken broth])`.
**Expected Outcomes:** `{ cuisine:["italian"], dishType:["pasta"], primaryIngredient:["seafood"] }`.
Assert `poultry` absent.

### Test Case 5: FDC-seed path when no title hit (AC6a)

**Preconditions:** Stub `FoodMatcher`: "salmon" → "Finfish and Shellfish Products" (high). Title has no
protein keyword (e.g. "Weeknight Sheet Pan Dinner").
**Steps:** `categorize("Weeknight Sheet Pan Dinner", ["salmon","broccoli","olive oil"])`.
**Expected Outcomes:** `primaryIngredient` includes `seafood` (FDC-seeded, highest quality); pantry
items ("olive oil") contribute nothing.

### Test Case 6: Cuisine escalates to classifier only when rules empty (AC6c)

**Preconditions:** Stub cuisine classifier returns `["thai"]`. A recipe whose title/ingredients have
no cuisine keyword.
**Steps:** `categorize(...)`; then a second recipe whose title contains an unambiguous cuisine keyword
the RuleTagger knows.
**Expected Outcomes:** First recipe's cuisine comes from the classifier (`thai`); second recipe's
cuisine comes from rules and the classifier is **not** called.

### Test Case 7: Empty result, no network (AC8)

**Preconditions:** Stub `FoodMatcher` returns null for all; stub classifier returns `[]`.
**Steps:** `categorize("Mystery", ["water"])`.
**Expected Outcomes:** `{ cuisine:[], dishType:[], primaryIngredient:[] }`; no exception; no network.

### Test Case 8: LLM output constrained to VOCAB (AC4)

**Preconditions:** A `LunaCuisineClassifier` with a mocked HTTP layer returning
`["italian","klingon"]`.
**Steps:** `classify("x", [], VOCAB.cuisine)`.
**Expected Outcomes:** Returns `["italian"]` — non-VOCAB `klingon` dropped; no throw.

## Test Run

_To be determined during execution._

## Deployment Strategy

No standalone deploy — this is library code with no callers until WI-TS-3 wires it in. It ships behind
WI-TS-3. The LLM tier activates only when `OPENAI_API_KEY` is present; without it the selector returns
the stub. No migration, no schema change.

## Production Verification

### Production Verification 1: Classifier selection

**Preconditions:** Deployed as part of WI-TS-3.
**Steps:** Confirm production env has `OPENAI_API_KEY`; trigger an import whose cuisine rules miss.
**Expected Outcomes:** The Luna classifier is exercised (a cuisine value is produced); logs show the
LLM tier was reached. (Full end-to-end verification belongs to WI-TS-3.)

## Production Verification Run

_To be determined during execution._
