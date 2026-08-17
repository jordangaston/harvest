# WI-2 — Ingredient→food matching + quantity conversion

## Background

With the FNDDS catalog seeded (WI-1), the estimator needs two internal operations before it can
aggregate macros: match each ingredient name to an FDC food, and convert its quantity to grams
(the catalog stores nutrients per 100 g). This work item builds the three collaborators the
estimator (WI-3) composes: `FdcFoodRepository` (reads the seeded catalog), `FoodMatcher`
(`normalize` → FTS5 bm25 lookup → quality tier), and `QuantityConverter` (mass/volume/count →
grams or null).

It also delivers the **e2e matching test** (design O-01, resolves Q-06): run the estimator's
matcher over the importer's real recipes against the **full seeded catalog** and assert a coverage
floor — the gap-finder for normalizer misses and missing synonyms. Its assertion is a floor, not
exact values (there is no accuracy SLA).

Depends on **WI-1** (`fdc_foods`, `fdc_food_nutrient`, the FTS5 mirror, `normalize()`,
`FDC_NUTRIENT`, `seedFdcFixture`).

Grounding:
- Ingredients are **already parsed** at import: `server/src/parse/ingredient.ts` →
  `parseIngredientLine()` → `StructuredIngredient { name, amount, unit, quantityText }`; the
  `ingredients` table (`schema.ts:127`) has `name`, `amount` (text), `unit`.
- Class convention: `static create(db)` factory, Zod parse at the repository boundary, methods
  ≤~10 lines (`server/CLAUDE.md`).
- Test helper: `migratedFileDb()` + `seedFdcFixture(db)` from WI-1.

## Objective

Ship `FdcFoodRepository`, `FoodMatcher`, and `QuantityConverter` with unit tests against the WI-1
fixture, plus an e2e matching test over the importer's real recipes against the full seed asserting
a per-corpus coverage floor. Thresholds are tunable defaults (design Q-01), documented as such.

## Acceptance Criteria

- **AC-1** — `FdcFoodRepository` (`server/src/nutrition/fdc-food-repository.ts`, `static create(db)`)
  exposes:
  - `search(tokens: string[]): FdcFoodCandidate[]` — runs an FTS5 `MATCH` over `fdc_foods_fts`
    ordered by `bm25()`, returning candidates each with `{ fdcId, description, descriptionNormalized,
    category, bm25 }` (lower bm25 = better; expose the raw score so `FoodMatcher` tiers on it). Under
    the WI-1 AC-3 fallback, it runs the `like` lookup and returns candidates with a comparable score.
  - `nutrients(fdcId: number): Map<string, number>` — returns the food's panel as
    `nutrientNumber → amountPer100g` (numbers parsed from text).
  - `portions(fdcId: number): { description: string; gramWeight: number }[]` — the food's stored
    portions (empty array when none).
  Rows are Zod-parsed at the boundary.
- **AC-2** — `FoodMatcher` (`server/src/nutrition/food-matcher.ts`, `static create(repo)`) exposes
  `match(name: string): FoodMatch | null` where `FoodMatch = { fdcId, category, quality }` and
  `quality ∈ {'high','medium','low'}`. It calls `normalize(name)` (WI-1), then `repo.search(tokens)`,
  and tiers the top candidate's bm25 against **accept / flag thresholds**: at least accept → `high`,
  at least flag → `low`, a middle band → `medium`, else return `null` (unmatched/reject). Thresholds
  are module constants with a `// tunable (Q-01)` comment and defaults chosen from the fixture; they
  are not universal truths.
- **AC-3** — `QuantityConverter` (`server/src/nutrition/quantity-converter.ts`,
  `static create(repo)`) exposes `toGrams(amount, unit, match): { grams: number; quality:
  'high'|'medium'|'low' } | null`:
  - **Mass** (`g`, `kg`, `oz`, `lb`, and the parser's spelled forms `gram`, `kilogram`, `ounce`,
    `pound`): exact constant × amount → `quality: 'high'`.
  - **Volume** (`tsp`, `tbsp`, `cup`, `ml`, `l`, spelled forms): convert to ml via constants, then
    ml × density, where density comes from a small table keyed on the matched food's `category`,
    defaulting to `1.0` g/ml (water) when the category is unknown → `quality: 'medium'`.
  - **Count / no unit** (`amount` present, unit null/empty; "2 eggs", "1 onion"): use a matching
    `each`/`large`/`medium` portion from `repo.portions(fdcId)` when present, else a short per-item
    gram table keyed on a token of the food name → `quality: 'low'`; if neither resolves → `null`
    (unconvertible).
  - Unrecognized unit, or amount missing/non-numeric where required → `null`.
  The density table and per-item table are minimal (design Q-02: water default + a handful of
  high-impact categories) with a `// tunable, widen if unmatched rate warrants` comment.
- **AC-4** — Unit tests cover `FoodMatcher.match` against the WI-1 fixture: a clean hit → `high`, a
  fuzzy/typo hit (e.g. `"mozzarela"`) → matched (any non-null tier), a no-match (e.g. `"xyzzy"`) →
  `null`.
- **AC-5** — Unit tests cover `QuantityConverter.toGrams`: mass exact (`100 g` → `100`, `high`);
  volume via water default and via a category density override; count via a portion and via the
  per-item table; an unconvertible count → `null`; an unrecognized unit → `null`.
- **AC-6** — Unit tests cover `FdcFoodRepository`: `search` returns fixture candidates ranked (best
  first) for a matching token; `nutrients(fdcId)` returns the salmon panel including DHA/vitamin D;
  `portions(fdcId)` returns the stored portions.
- **AC-7** — An **e2e matching test** (`server/test/e2e/nutrition-matching.e2e.test.ts`, run via
  `npm run test:e2e`) loads the importer's real recipes from `server/test/fixtures/e2e-recipes.json`,
  seeds the **full** `fdc_foods`/`fdc_food_nutrient` from the on-disk exports (or the seed script's
  insert path), runs every ingredient through `FoodMatcher`, reports per recipe which ingredients
  matched (and at what quality) and which did not, and asserts a **coverage floor** (a named
  constant, e.g. `MIN_MATCH_RATE`) across the corpus — not exact macro values. A small exporter
  dumps the importer's e2e recipe set to `e2e-recipes.json` so new recipes flow in by re-export.
  `[ASSUMPTION: the importer's e2e recipe corpus already exists in a form the exporter can read; if
  not, seed e2e-recipes.json with a small hand-picked set of real ingredient lines and note it. The
  floor constant is a starting value to be tuned (Q-01/Q-06), so pick a conservative floor that
  passes on the current seed and document it.]`
- **AC-8** — `npm run test` and `npm run typecheck` pass; the e2e test passes under `npm run
  test:e2e`; no test hits the network.

## Test Cases

### Test Case 1: `FoodMatcher` tiers a clean hit, a typo hit, and a miss (AC-2, AC-4)

**Preconditions:** WI-1 fixture seeded on `migratedFileDb()`; `FoodMatcher.create(FdcFoodRepository
.create(db))`.

**Steps:**
1. `match("fresh spinach")` → expect `quality: 'high'`, `fdcId` = the spinach fixture food.
2. `match("mozzarela")` (deliberate typo, fixture has mozzarella) → expect non-null, any tier
   (trigram/`like` tolerance).
3. `match("xyzzy nonexistent")` → expect `null`.

**Expected Outcomes:** As stated; the clean hit is `high`, the typo matches, the nonsense returns
`null`.

### Test Case 2: `QuantityConverter` mass/volume/count/unconvertible (AC-3, AC-5)

**Preconditions:** Fixture seeded; a `FoodMatch` for an oil food (dense-ish category) and for eggs
available.

**Steps:**
1. `toGrams("100", "g", saladMatch)` → `{ grams: 100, quality: 'high' }`.
2. `toGrams("1", "cup", waterlikeMatch)` where the food's category is unknown → grams ≈
   `240 × 1.0`, `quality: 'medium'` (water default).
3. `toGrams("1", "cup", oilMatch)` where oil's category has a density override < 1.0 → grams less
   than the water result, `quality: 'medium'`.
4. `toGrams("2", null, eggMatch)` where the egg food has an `each`/`large` portion → grams =
   `2 × portionGramWeight`, `quality: 'low'`.
5. `toGrams("1", null, matchWithNoPortionAndNoPerItemEntry)` → `null`.
6. `toGrams("1", "handful", anyMatch)` (unrecognized unit) → `null`.

**Expected Outcomes:** Each returns the stated grams/quality or `null`; the oil result is strictly
less than the water-default result at the same volume.

### Test Case 3: `FdcFoodRepository` search/nutrients/portions (AC-1, AC-6)

**Preconditions:** Fixture seeded.

**Steps:**
1. `search(["salmon"])` → salmon fixture food ranked first.
2. `nutrients(salmonFdcId)` → a `Map` containing `328` (vitamin D) and `621` (DHA) with numeric
   values.
3. `portions(salmonFdcId)` → the stored portions array (or `[]`).

**Expected Outcomes:** Search ranks the expected food first; the nutrient map carries omega-3 +
vitamin D as numbers; portions returns the stored list.

### Test Case 4: e2e coverage floor over real recipes (AC-7)

**Preconditions:** `e2e-recipes.json` populated from the importer's corpus; the full catalog seeded
from the on-disk exports (offline — the export is committed test data, not a network fetch).

**Steps:**
1. Run `npm run test:e2e`.
2. The test iterates every recipe's ingredients through `FoodMatcher`, tallying matched vs unmatched
   and per-quality counts, logging a per-recipe report.
3. It computes the corpus match rate and asserts it `>= MIN_MATCH_RATE`.

**Expected Outcomes:** The assertion passes at the documented floor; the report lists any unmatched
ingredients (the gap surface). The test performs no network access — the catalog is seeded from
committed exports.

### Test Case 5: Suite, typecheck, e2e green (AC-8)

**Steps:** Run `npm run test`, `npm run typecheck`, `npm run test:e2e` in `server/`.

**Expected Outcomes:** All pass; no network.

## Test Run

To be filled during execution.

## Deployment Strategy

**No schema or API change** in this work item — it adds three read-only classes plus tests over the
WI-1 catalog. Nothing new is persisted or served; the estimator (WI-3) is the first caller. Deploy
is a code-only additive change riding on WI-1's tables.

**Rollback:** the classes are unreferenced by any request path until WI-3 wires them, so a rollback
is a plain redeploy of the prior build with no data implications.

Thresholds (match accept/flag, densities, per-item grams) are tunable constants (Q-01, Q-02); tuning
them post-launch is a code change, not a migration.

## Production Verification

### Production Verification 1: Matcher resolves common ingredients against the live catalog

**Preconditions:** WI-1 catalog seeded in the target DB; a REPL/script path or the WI-3 import flow
available.

**Steps:**
1. Against the live catalog, run `FoodMatcher.match` for a handful of common ingredient names
   (`"olive oil"`, `"chicken breast"`, `"salmon"`, `"all-purpose flour"`).
2. For a matched food, run `QuantityConverter.toGrams` for `"1 cup"` and `"100 g"`.

**Expected Outcomes:** The common names return non-null matches at reasonable tiers; conversions
return sensible grams (`100 g` → `100`, `1 cup` in the expected order of magnitude). This is a smoke
check that the seed + FTS index behave in the target DB; it is exercised end-to-end by WI-3's
production verification.

## Production Verification Run

To be filled during execution.
