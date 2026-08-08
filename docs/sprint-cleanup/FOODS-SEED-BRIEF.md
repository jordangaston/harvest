# Rebuild the food catalog seed from real USDA data (C5a follow-up)

The current `server/seed/foods.json` is only **45 hand-curated foods** — too thin, so nutrition falls below the
≥0.6 coverage floor on nearly every real recipe. Rebuild it from the real USDA datasets the founder provided.

## Source files (JSON, NOT csv — do NOT commit these raw files; they're huge)
- SR Legacy (base, breadth ~7,800): `~/Desktop/Business/Harvest/FoodData_Central_sr_legacy_food_json_2018-04.json`
  — top-level key **`SRLegacyFoods`** (array). **210 MB** — stream-parse it (a streaming JSON parser like
  `stream-json`, or `jq`-preprocess to project needed fields first). Do NOT naively `JSON.parse` the whole
  210 MB in Node without bumping the heap; prefer streaming.
- Foundation (overlay, current, 395): `~/Desktop/Business/Harvest/FoodData_Central_foundation_food_json_2026-04-30.json`
  — top-level key **`FoundationFoods`**. Small; parse directly.

Per-food shape (both): `fdcId`, `description`, `foodCategory.description`, `foodNutrients[] = {nutrient:{number,
id, name, unitName}, amount}` (amounts are per **100 g**), `foodPortions[] = {amount, modifier, gramWeight,
measureUnit:{name}}`.

## Nutrient map — the 8 label-core, by FDC nutrient id (fallback: number)
- calories = id **1008** (num 208), Energy kcal. In Foundation a food may also carry Atwater energy
  (2047/2048); prefer id 1008 / "Energy" kcal.
- grams_of_protein = **1003** (203) · grams_of_fat = **1004** (204) · grams_of_carbohydrate = **1005** (205)
- grams_of_fiber = **1079** (291) · grams_of_sugar = **2000** (269, "Sugars, total")
- grams_of_saturated_fat = **1258** (606) · milligrams_of_sodium = **1093** (307)
Store per-100g exactly as the FDC amount (kcal / g / mg). A missing nutrient → null for that field (don't fabricate).

## Curate (don't dump all ~7,800)
Filter to **common cooking ingredients** by `foodCategory` — include e.g. Vegetables and Vegetable Products,
Fruits and Fruit Juices, Dairy and Egg Products, Poultry/Beef/Pork/Lamb Products, Finfish and Shellfish,
Legumes and Legume Products, Cereal Grains and Pasta, Nut and Seed Products, Fats and Oils, Spices and Herbs,
Baked Products (basics). Prefer basic/raw forms; drop obviously branded descriptions (SR Legacy has some, e.g.
"Pillsbury …"), mixed/prepared dishes, Fast Foods, Restaurant Foods, Baby Foods. Target **a few hundred** common
foods (generous is fine — even ~800–1000 keeps `foods.json` under ~1 MB). Per food emit:
`{ name (canonical head-noun, lowercased — first comma-segment of the description), aliases[], category (the
foodCategory, kept for curation + future Wave-2 grocery aisle grouping), the 8 per-100g nutrients, portions[]
({amount, unit, gramWeight}) }`. Hand-add `aliases` for staples + known synonyms (eggplant↔aubergine,
cilantro↔coriander, chickpea↔garbanzo, scallion↔green onion, heavy cream↔heavy whipping cream, etc.).

Merge SR Legacy (base) + Foundation (overlay): dedupe by canonical name; **prefer Foundation's values on overlap**
(newer/higher-quality). Ensure common volumetric **dry goods** (flour, sugar, rice, oats, cocoa) carry a `cup`
portion so `toGrams` hits the portion path and never the water-density fallback (Architect M4).

## Wire-up + guardrails
- `build-foods-seed.ts` takes the two file paths as args, streams/curates/merges, and writes
  `server/seed/foods.json`. Keep the raw source files OUT of git (gitignore or just don't `git add`).
- Keep the existing matcher/`FoodCatalog` behavior. The test fixture stays a small deterministic subset (or the
  existing unit tests keep their own tiny fixture) so unit tests stay fast and offline — do NOT make tests load
  the full seed if that slows them; keep `food-catalog.test.ts` assertions valid (incl. `"cream"` ≠ `"ice cream"`,
  and the `StubWebsiteFetcher.FIXTURE` foods chicken breast / garlic / heavy cream present with their portions).
- **Keep the WHOLE server suite green** (offline). 

## Verify real coverage (this is the point — report numbers)
After rebuilding, exercise the catalog against a handful of **real** recipes (use the e2e sample URLs from the
import tests, or a representative 8–12-ingredient list per recipe). Report: total foods in the seed, and for
~5 real recipes the **per-recipe match rate** and whether each clears the ≥0.6 floor (i.e. does nutrition
actually `compute` now vs null). Log the numbers in the sprint report/postmortem.

## Done
Whole suite green + the coverage numbers reported + `foods.json` rebuilt (raw sources not committed) + commit
pushed to `jordangaston/cleanup-sprint` (updates PR #15) + SPRINT-REPORT/POSTMORTEM updated (C5a seed now real,
with the coverage numbers). Report `worker_done` with the seed size, the coverage numbers, the commit, and the
test summary. Decide-and-log blockers; don't stop.
