# Phase 1 — Reference analysis (light)

Cleanup's two references were already analyzed in `DESIGN.md` (Rev 2); this note captures what we took.

## heb-bot (`~/workspace/heb-bot`)
- **`src/normalizeIngredients.ts`** — the `Ingredient`/`Measurement` shape and the LLM normalization prompt.
  We adopt its model **trimmed**: our `StructuredIngredient = { name, amount, unit, quantityText }` keeps a
  **single** `amount`/`unit` (heb-bot's `measurements[]` array and grocery-only `searchTerms`/`optional` are
  dropped). We take its unit vocabulary (lowercase singular: teaspoon/tablespoon/cup/ounce/pound/gram/count)
  and the "verbatim raw line kept for display" idea (→ our `quantity_text`). We deliberately **do not** adopt
  its LLM-driven unit-algebra ("1 tbsp + 1 tsp → 4 teaspoon"): our `parseIngredientLine` is minimal and
  deterministic — ambiguous → `amount/unit` null, `quantityText` preserved (Architect S4).
- **`src/pantry.ts`** — a curated staples set + normalize-for-match (lowercase/trim/collapse). This validated
  the **curated-list + canonical-name + alias** approach that our `FoodCatalog` matcher uses (Architect M3),
  rather than fuzzy-matching raw USDA descriptions.

## USDA FoodData Central (FDC)
- **SR Legacy** is the generic-cooking dataset. Per-100 g nutrients by id: calories **1008**, protein **1003**,
  total fat **1004**, carbohydrate **1005**, fiber **1079**, total sugars **2000**, saturated fat **1258**,
  sodium **1093** — the eight Nutrition-Facts label-core fields (C5). `food_portion` rows give per-food
  portion→gram weights (cup→grams density) used by `toGrams`.
- Per the founder, the catalog is **in-memory** from a committed curated `server/seed/foods.json` (canonical
  name + aliases + 8 nutrients per 100 g + portions), **not** DB tables — nutrition is computed at import and
  stored on the recipe, so the catalog never backs a read query. Values are USDA-sourced; `build-foods-seed.ts`
  documents rebuilding from the bulk CSV.

Everything above is already reflected in `DESIGN.md`; specs cite it.
