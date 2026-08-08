---
tags: [harvest, cleanup, spec]
story: C5a
summary: "In-memory FoodCatalog loaded once from a committed curated foods.json (no DB tables, no pg_trgm, no migration): lexical + alias + Sørensen–Dice matching, and volume→grams conversion, both offline and swappable."
source: docs/sprint-cleanup/DESIGN.md (Revision 2 — C5a, Matching, Deployment → Food catalog, Decisions), docs/sprint-cleanup/ARCHITECT-REVIEW.md (M3, M4, Q-05)
consumed_by: spec-05-c5-nutrition.md (NutritionService.compute)
---

# C5a — In-memory USDA food catalog + matcher

## Background

The C5 computed nutrition path (spec-05) needs, per ingredient, (a) the food it refers to and (b) how
many grams the ingredient's amount+unit represent. Both are served by an **in-memory `FoodCatalog`**
loaded once from a **committed curated `server/seed/foods.json`** — a value object, **not a DB table**.
Per the founder there are **no `foods`/`food_portions` tables, no `pg_trgm`, and no migration 0009**;
nutrition is computed at import and stored on the recipe, so the catalog serves the import path
transiently and never backs a read query (DESIGN.md "C5a food catalog is in-memory").

The whole risk of C5/C5a is **generic-name → USDA match accuracy** (ARCHITECT-REVIEW.md M3). SR Legacy
descriptions are taxonomic (`"Garlic, raw"`, `"Cream, fluid, heavy whipping"`); ingredient names are
casual (`"garlic"`, `"heavy cream"`). Raw fuzzy matching misses the real food and confidently returns a
wrong one (`"cream"` ~ `"ice cream"`). The founder-approved answer is **lexical + an alias table +
Sørensen–Dice on character bigrams with a ≥ 0.8 floor — not embeddings**: it rewards shared spelling, not
semantic neighborhood, so `"cream"` scores low against `"ice cream"` rather than being pulled in. A
curated seed (canonical head-noun names + hand-checked aliases) is what makes this tractable
(ARCHITECT-REVIEW.md Q-05 / M3).

## Objective

Ship a `FoodCatalog` singleton that loads a committed curated `foods.json`, exposes `matchFood(name)`
(behind a swappable `FoodMatcher` interface) and `toGrams(amount, unit, food)`, both fully offline; plus
the `server/scripts/build-foods-seed.ts` that documents how the curated JSON is built from USDA SR
Legacy, and a committed `foods.json` (~40 staples) whose ~10-food subset is the test fixture.

## Acceptance Criteria

- **AC1 — no DB.** No `foods`/`food_portions` tables, no `pg_trgm`, no migration 0009 anywhere in the
  change. `scaffold.test.ts` asserts their absence (per DESIGN.md Testing).
- **AC2 — singleton load.** `FoodCatalog.create()` reads `server/seed/foods.json` **once** and returns a
  shared instance; repeated `create()` calls do not re-read the file.
- **AC3 — foods.json shape.** Each entry is
  `{ name: string, aliases: string[], per100g: LabelCore, portions: { unit: string, grams: number }[] }`,
  where `LabelCore` holds the eight keys from spec-05 (`calories, gramsOfFat, gramsOfSaturatedFat,
  gramsOfCarbohydrate, gramsOfFiber, gramsOfSugar, gramsOfProtein, milligramsOfSodium`) as numbers per
  100 g.
- **AC4 — normalize.** Both the ingredient name and each candidate (canonical `name` + every `alias`) are
  normalized identically before matching: lowercase; strip punctuation; drop stop-list descriptor/prep
  tokens; naive-singularize each token; collapse whitespace.
- **AC5 — exact/alias.** A normalized ingredient equal to a food's normalized canonical name **or** any
  normalized alias returns that food. Aliases carry nutrition-identity synonyms
  (`aubergine↔eggplant`, `cilantro↔coriander`, `garbanzo↔chickpea`,
  `heavy cream↔heavy whipping cream`, `scallion↔green onion`).
- **AC6 — head-noun / token-subset.** When all of a food's normalized canonical tokens appear in the
  ingredient's normalized token set, that food matches; the candidate with the largest token overlap wins
  (`"extra virgin olive oil"` → `olive oil`).
- **AC7 — bounded fuzzy.** Otherwise, compute the Sørensen–Dice coefficient on character bigrams between
  the normalized ingredient and each candidate; take the single best **only if ≥ 0.8**, else `null`.
- **AC8 — no match → null.** No confident match returns `null`. In particular `"cream"` must **not**
  match `"ice cream"` (the ≥ 0.8 Dice floor enforces the nutrition-identity guardrail).
- **AC9 — swappable matcher.** `matchFood` is defined by a `FoodMatcher` interface so the strategy can be
  replaced without touching `NutritionService`.
- **AC10 — toGrams weight.** `toGrams(amount, unit, food)` converts weight units directly:
  `gram/g`, `kilogram/kg`, `ounce/oz`, `pound/lb` → grams, independent of the food.
- **AC11 — toGrams volume via portion.** A volume unit (`cup`, `tablespoon`/`tbsp`, `teaspoon`/`tsp`,
  `ml`, `l`, …) converts via the food's own `portions` (unit → grams for that food).
- **AC12 — toGrams water-like fallback.** A volume unit with **no** matching portion falls back to
  water density (1 ml = 1 g, with cup/tbsp/tsp→ml) **only** for water-like liquids
  (water, broth, stock, milk, juice).
- **AC13 — toGrams dry-goods no portion → null.** A volume unit with no matching portion for a
  non-water-like (dry) food returns `null` (unmatched — never a water guess; ARCHITECT-REVIEW.md M4).
- **AC14 — offline.** `FoodCatalog` performs no network I/O; `build-foods-seed.ts` runs manually and is
  never invoked by tests or CI. Tests load a small committed fixture subset.

## Files & functions touched

| Path | Symbol | Change |
|---|---|---|
| `server/src/nutrition/food-catalog.ts` (new) | `FoodCatalog` class, `static create()`, `matchFood(name): Food \| null`, `toGrams(amount, unit, food): number \| null`; `Food`, `Portion`, `FoodMatcher` types | The catalog + matcher + converter. |
| `server/src/nutrition/normalize.ts` (new, small) | `normalize(name): string[]` (or `(string, string[])`), `STOP_LIST` | Shared normalization used by both sides of the match. Keep tiny. |
| `server/seed/foods.json` (new, committed) | — | ~40 curated cooking staples in the AC3 shape; hand-authored from USDA SR Legacy values. |
| `server/scripts/build-foods-seed.ts` (new) | one-shot builder | Documents + performs building the curated JSON from the SR Legacy bulk CSVs. Manual run only; not wired into tests/CI. |
| `server/tests/fixtures/foods.json` (new) | — | ~10-food subset fixture used by the matcher/`toGrams`/compute unit tests (offline by construction). |
| `server/src/services/nutrition-service.ts` | consumer (spec-05) | Depends on `FoodCatalog` — not modified here beyond that dependency. |
| `server/tests/scaffold.test.ts` | schema audit | Assert **no** `foods`/`food_portions` tables and **no** `pg_trgm` (shared with the C6/C5 audit updates). |

`Food = { name: string; aliases: string[]; per100g: LabelCore; portions: Portion[] }`;
`Portion = { unit: string; grams: number }`. `LabelCore` is the eight-key numeric shape from spec-05
(reuse `server/src/models/nutrition.ts`, numeric per-100 g here vs. string-per-serving on the recipe).

## Implementation notes

### Ladder / laziness (ponytail)

- **No DB, no ORM, no migration** — a `readFileSync` + `JSON.parse` at `create()` behind a module-level
  singleton is the whole loader.
- **Sørensen–Dice bigrams** is ~10 lines (bigram sets → `2·|A∩B| / (|A|+|B|)`); no library. It is the
  founder-mandated algorithm — not a place to substitute a flimsier heuristic.
- `build-foods-seed.ts` is a **documented manual script**, not production code. If the CSVs are
  unreachable, hand-author the curated `foods.json` from published USDA SR Legacy per-100 g values — the
  committed JSON is the deliverable, the script is the recipe for regenerating it.

### Normalization (AC4)

`normalize` lowercases, strips punctuation, drops stop-list tokens, naive-singularizes, collapses
whitespace, returns the token list (and/or the joined string). Apply it identically to the ingredient
name and to every candidate string (canonical `name` and each `alias`) — precompute normalized
candidates once at load.

**Stop-list** (descriptor/prep tokens dropped — from DESIGN.md Matching):
`fresh, chopped, minced, diced, sliced, raw, cooked, large, small, medium, finely, roughly, ground,
to taste, for garnish, for serving, optional, room temperature, …` (multi-word entries like `to taste`
matched as phrases before tokenizing, or as adjacent-token drops). Keep it a small explicit set; extend
via the unmatched log post-launch.

**Singularize** is naive plural→singular (`tomatoes→tomato`, trailing `s`/`es` heuristics) — no
inflection library.

### Matching pipeline (AC5–AC8) — first confident tier wins

1. **Exact** — normalized ingredient == a candidate's normalized string (canonical or alias) → that food.
2. **Head-noun / token-subset** — every normalized canonical token of a food ⊆ the ingredient's
   normalized token set → candidate; if several, the largest token overlap wins.
3. **Bounded fuzzy** — Sørensen–Dice on character bigrams of the normalized strings; single best
   candidate, returned only if score **≥ 0.8**, else `null`.
4. No tier hits → `null` (spec-05's caller logs `nutrition.unmatched_ingredient`).

`FoodMatcher` interface: `{ match(normalizedIngredient): Food | null }`; the default implementation runs
the four tiers. `FoodCatalog.matchFood` delegates to the injected/default matcher so `NutritionService`
never depends on the strategy (AC9).

### toGrams (AC10–AC13)

- **Weight units** convert directly (food-independent): `g/gram(s)`→×1, `kg/kilogram(s)`→×1000,
  `oz/ounce(s)`→×28.3495, `lb/pound(s)`→×453.592.
- **Volume units**: look up the unit in the food's `portions` (e.g. `{unit:"cup", grams:120}`); if found,
  `grams = amount × portion.grams`. Support `cup(s)`, `tablespoon(s)`/`tbsp`, `teaspoon(s)`/`tsp`, `ml`,
  `l/liter(s)` — normalize unit aliases before lookup.
- **No portion match**:
  - Water-like food (name/alias in `{water, broth, stock, milk, juice}`) → water-density fallback:
    convert the volume to ml (`cup→236.6`, `tbsp→14.79`, `tsp→4.93`, `ml→1`, `l→1000`) then `× 1 g/ml`.
  - Otherwise (dry good) → `null` (M4 — an honest unmatched beats a ~2× overstatement on flour/sugar).
- Unknown/absent unit or unparseable `amount` → `null`.
- `amount` arrives as a string (StructuredIngredient); parse to number, `null` on failure.
- **Seed guardrail (M4):** the curated `foods.json` **must** carry `portions` (cup/tbsp) for the top
  volumetric dry goods (flour, sugar, rice, oats, …) so they hit the portion path and never the fallback.

## Test Cases

All offline over the fixture `foods.json` (server/CLAUDE.md — tests never hit the network). C5a is unit
only (DESIGN.md Test Coverage: "C5a catalog match + toGrams — Op — unit").

### Test Case 1: matcher guardrail table (AC5–AC8)

**Preconditions:** Fixture catalog containing `garlic`, `eggplant` (alias `aubergine`),
`olive oil`, `tomato`, and `ice cream` (or an entry that would tempt a `cream` mismatch).

**Steps:** Call `matchFood(name)` for each row.

**Expected Outcomes:**

| Input | Tier | Result |
|---|---|---|
| `"garlic"` | exact | `garlic` |
| `"aubergine"` | alias | `eggplant` |
| `"extra virgin olive oil"` | head-noun / token-subset | `olive oil` |
| `"tomatoes"` | normalize (plural) → exact | `tomato` |
| `"finely chopped garlic"` | normalize (stop-list) → exact | `garlic` |
| `"dragonfruit foam"` (no near candidate) | fuzzy < 0.8 | `null` |
| `"cream"` (catalog has `ice cream`, not `cream`) | fuzzy < 0.8 | **`null`** — must NOT match `ice cream` |

### Test Case 2: toGrams — weight direct (AC10)

**Preconditions:** Any fixture food.

**Steps:** `toGrams("2", "pound", food)`, `toGrams("100", "g", food)`, `toGrams("8", "oz", food)`.

**Expected Outcomes:** `≈ 907.18`, `100`, `≈ 226.8` — food-independent.

### Test Case 3: toGrams — volume via the food's portion (AC11)

**Preconditions:** A fixture food with `portions: [{unit:"cup", grams:120}]` (e.g. flour).

**Steps:** `toGrams("2", "cup", food)`.

**Expected Outcomes:** `240`.

### Test Case 4: toGrams — water-like fallback (AC12)

**Preconditions:** A water-like fixture food (e.g. `broth`) with no `cup` portion.

**Steps:** `toGrams("1", "cup", broth)`.

**Expected Outcomes:** `≈ 236.6` (water density on the ml-converted volume).

### Test Case 5: toGrams — dry-goods volume, no portion → null (AC13)

**Preconditions:** A dry (non-water-like) fixture food with no `cup` portion.

**Steps:** `toGrams("1", "cup", food)`.

**Expected Outcomes:** `null` (never a water guess).

### Test Case 6: singleton loads once (AC2, AC14)

**Preconditions:** —

**Steps:** Call `FoodCatalog.create()` twice; (optionally) spy the file read.

**Expected Outcomes:** Same instance / one file read; no network.

### Test Case 7: foods.json shape (AC3) + scaffold audit (AC1)

**Preconditions:** Committed `server/seed/foods.json`.

**Steps:** Load and validate every entry has `name`, `aliases[]`, `per100g` with the eight keys, and
`portions[]` of `{unit, grams}`; run `scaffold.test.ts`.

**Expected Outcomes:** All entries well-formed; the schema audit confirms **no** `foods`/`food_portions`
tables and **no** `pg_trgm`.

## Test Run

_To be filled in during execution — commands, output, pass/fail per test case._

## Deployment Strategy

Direct deploy — the catalog is a bundled file loaded at runtime; there is no migration, no DB change, and
no seed job. Ensure `server/seed/foods.json` is included in the build/package output. `build-foods-seed.ts`
is a developer tool, never run in CI or at deploy. Roll back by reverting the code + JSON.

## Production Verification

### Production Verification 1: catalog serves computed nutrition

**Preconditions:** Deployed build includes `foods.json`; C5 (spec-05) wired.

**Steps:** Import a recipe of common staples with no parsed nutrition.

**Expected Outcomes:** The recipe persists `nutrition_source='computed'` with plausible per-serving
macros; `nutrition.unmatched_ingredient` logs name only the genuinely exotic items; no dry-goods 2×
overstatement (flour/sugar hit the portion path).

## Production Verification Run

_To be filled in after deploy — evidence per verification case._

## Out of scope

- The `recipes` nutrition columns, migration 0008, `RecipeSchema`/`PublicRecipe` changes, and
  `NutritionService.compute` itself — that is spec-05 (this spec provides `matchFood` + `toGrams` it
  consumes).
- The 0.6 coverage floor and the `nutrition.below_coverage_floor` log — spec-05 (this spec only reports
  per-ingredient matched/null; "matched AND gramsable" is the floor's input).
- Any `foods`/`food_portions` table, `pg_trgm`, embeddings/vector search, or migration 0009.
- Automating `build-foods-seed.ts` in CI, or downloading USDA CSVs at build/deploy time.
- Expanding the catalog beyond a curated cooking subset, or micronutrients beyond the eight label-core
  fields.
- Integration-testing the catalog against Postgres (it is in-memory; unit tests cover it).
