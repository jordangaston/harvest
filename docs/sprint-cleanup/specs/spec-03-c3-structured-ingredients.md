---
tags: [harvest, cleanup, spec, C3]
story: C3 — structured ingredient measurements
source_of_truth: docs/sprint-cleanup/DESIGN.md (Revision 2)
architect: docs/sprint-cleanup/ARCHITECT-REVIEW.md (M1, M2, N3, S4)
migration: none (columns already exist)
---

# Spec 03 — C3: Structured Ingredient Measurements

## Summary

Populate the three ingredient columns that already exist but are always written null
today (`amount numeric`, `unit text`, `quantity_text text` — verified in
`server/src/db/schema/ingredients.ts:12-14`). A new **minimal, deterministic**
`parseIngredientLine(raw)` splits a raw ingredient string into `{ name, amount, unit,
quantityText }`. It runs at a single new **`toExtractedData` adapter** — the one
`ExtractedRecipe → ExtractedRecipeData` promotion point for every JSON-LD source — and on
the LLM path the extractor returns `StructuredIngredient[]` directly. The persist and
PATCH-edit paths then write the four columns so imported *and* edited recipes carry
scalable amounts.

**No migration.** C3 is code-only; the columns exist and are nullable. The
"never-null `quantity_text`" rule is a code invariant enforced in the parser
(Architect N3), not a DB constraint.

The parser is deliberately minimal (Architect S4 / Q-02): a leading
integer/decimal/simple-fraction → `amount`; a following known lowercase-singular unit
(+ abbreviations) → `unit`; the rest → `name`; `quantityText = raw`. **Anything
ambiguous** (ranges like `6-8`, "plus" clauses, no leading number) → `amount`/`unit`
null, whole line = `name`, `quantityText` preserved. No unit-algebra, no range math, no
"plus"-combining. An unscalable line is honest; a wrongly-combined one is a bug.

## Acceptance Criteria

- [ ] `parse/ingredient.ts` exports `parseIngredientLine(raw: string): StructuredIngredient`
      and the `StructuredIngredient` type `{ name: string; amount: string | null; unit: string | null; quantityText: string }` — `amount` is a **string** to match the pg `numeric` convention.
- [ ] `parseIngredientLine("2 cups flour")` → `{ name: "flour", amount: "2", unit: "cup", quantityText: "2 cups flour" }`.
- [ ] `parseIngredientLine("1 lb chicken")` → `{ name: "chicken", amount: "1", unit: "pound", quantityText: "1 lb chicken" }` (abbreviation `lb` → canonical `pound`).
- [ ] `parseIngredientLine("3 large eggs")` → `{ name: "large eggs", amount: "3", unit: null, quantityText: "3 large eggs" }` (leading number kept; `large` is not a unit, so no unit and the remainder stays whole).
- [ ] Ambiguous lines return `amount: null, unit: null, name: <whole raw line>, quantityText: <raw>`: `"1 tbsp plus 1 tsp butter"`, `"6-8 wings"`, `"salt to taste"`.
- [ ] `quantityText` always equals the raw input, never null, for every input.
- [ ] `toExtractedData(structured, extras)` (new, in `import-pipeline.ts`) is the single `ExtractedRecipe → ExtractedRecipeData` promotion: it maps each raw ingredient string through `parseIngredientLine` and carries the other fields (title/steps/servings/times/imageUrl + `confidence` from `extras`). It replaces the five inline `{ ...structured, confidence: 1 }` spreads.
- [ ] All five JSON-LD promotion sites route through `toExtractedData`: website (`:91`), outbound link (`:124`), IG/FB (`:211`), TikTok (`:255`), Pinterest link (`:242`) and `pin.recipe` (`:247`).
- [ ] `ExtractedRecipe.ingredients` stays `string[]` (`fetch/website.ts:11-21`); `mapRecipe` stays a pure string extractor; `StubWebsiteFetcher.FIXTURE` is untouched.
- [ ] `ExtractedRecipeData.ingredients` becomes `StructuredIngredient[]` (`parse/extractor.ts`). The LLM extractor (`toData`) returns `StructuredIngredient[]` directly; `StubExtractor` returns one structured stub so tests stay offline.
- [ ] `stripSectionLabels` filters **structured ingredients by `.quantityText`** (was a `string[]` filter — Architect M1); step stripping stays a `string[]` filter.
- [ ] `RecipeInput.ingredients` becomes `StructuredIngredient[]`; `RecipeRepository.insertIngredients` and `replaceIngredients` persist `amount`, `unit`, `quantity_text` (plus `name`, `icon`) — Architect M2.
- [ ] The PATCH edit path (`RecipeService.update`) runs `parseIngredientLine` on `edit.ingredients` (still `string[]` over the wire) before `updateContent`, so editing does not strip scalability (Architect M2).
- [ ] Persisted ingredient rows carry non-null `amount`/`unit`/`quantity_text` for parseable lines (integration).

## Files & functions touched (verified against code)

### New

- **`server/src/parse/ingredient.ts`** — `parseIngredientLine(raw): StructuredIngredient` + the `StructuredIngredient` type + the `UNITS` map. This is the deterministic parser; imported by the adapter, the extractor stub, and `recipe-service.ts`.

### `server/src/pipeline/import-pipeline.ts`

- **`toExtractedData(structured: ExtractedRecipe, extras: { confidence: number; nutrition?: … }): ExtractedRecipeData`** — new module-level function. Replaces the inline spreads at:
  - `run` website branch — `:91` (`{ ...material.structured, confidence: 1 }`).
  - `run` outbound-link branch — `:124` (`{ ...structured, confidence: 1 }`).
  - `fromApify` — `:211` (`{ structured: await website.fetch(post.outboundLink) }` feeds `material.structured`, promoted at `:91`).
  - `fromTikTok` — `:255` (same — feeds `material.structured`, promoted at `:91`).
  - `fromPinterest` — `:242` (`{ structured: await website.fetch(pin.link) }`) and `:247` (`{ structured: pin.recipe }`) — both feed `material.structured`, promoted at `:91`.
  - **Note:** `:211`/`:242`/`:247`/`:255` set `material.structured`; the single spread that actually builds `ExtractedRecipeData` from it is `run` `:91`. The outbound-link path builds its own at `:124`. So `toExtractedData` replaces the spreads at **`:91` and `:124`** — the two sites that materialize `ExtractedRecipeData` from an `ExtractedRecipe`; the other four are the sources that populate `structured`. Confirm both `withThumbnail(toExtractedData(...))` call sites compile against the new `ExtractedRecipeData` (structured ingredients).
- **`toRecipeInput` (`:408`)** — `data.ingredients` is now `StructuredIngredient[]`; pass it straight to `RecipeInput.ingredients` (no re-parse). Section-label stripping now uses the structured filter (below).
- **`stripSectionLabels` (`:436`)** — keep the existing `string[]` overload for steps. Add a structured variant (or generalize) that filters `StructuredIngredient[]` by `.quantityText` through `isSectionLabel` (`:427`), preserving the "never empty a non-empty list" no-op guard (`:437-438`).

### `server/src/fetch/website.ts`

- **No structural change for C3.** `ExtractedRecipe.ingredients` stays `string[]` (`:11-21`), `mapRecipe` (`:119`) unchanged, `StubWebsiteFetcher.FIXTURE` (`:67`) unchanged. (The `nutrition` field addition lives in spec-05/C5, not here.)

### `server/src/parse/extractor.ts`

- **`ExtractedRecipeData` (`:25-27`)** — `ingredients: StructuredIngredient[]` instead of inheriting `ExtractedRecipe.ingredients: string[]`. Since it `extends ExtractedRecipe`, override the field: declare `interface ExtractedRecipeData extends Omit<ExtractedRecipe, 'ingredients'> { ingredients: StructuredIngredient[]; confidence: number; }`.
- **`toData` (`:57-68`)** — map `raw.ingredients` (LLM returns objects) into `StructuredIngredient[]`; keep the array-guard. Extend `SYSTEM_PROMPT` (`:33-43`) so the model emits `ingredients` as objects `{ name, amount, unit, quantityText }` (one network call, no second pass).
- **`StubExtractor.extract` (`:113-123`)** — return one structured stub, e.g. `ingredients: title ? [{ name: '1 serving of ' + title, amount: null, unit: null, quantityText: '1 serving of ' + title }] : []`.

### `server/src/repositories/recipe-repository.ts`

- **`RecipeInput.ingredients` (`:17`)** — `StructuredIngredient[]` instead of `string[]`.
- **`insertIngredients` (`:114-119`)** — take `StructuredIngredient[]`; each insert row = `{ recipeId, position: i, name: ing.name, quantityText: ing.quantityText, amount: ing.amount, unit: ing.unit, icon: mapIngredientIcon(ing.name) }`.
- **`replaceIngredients` (`:275-280`)** — same shape (used by `updateContent`).
- `persist` (`:76-84`) call to `insertIngredients` passes `recipe.ingredients` (now structured) — no signature change at the call site.

### `server/src/services/recipe-service.ts`

- **`update` (`:38-42`)** — before `updateContent`, map `edit.ingredients` (still `string[]` from `updateRecipeSchema`) through `parseIngredientLine`; pass the resulting `StructuredIngredient[]` to `updateContent` (Architect M2). (Ownership/404 change is spec-07/C6; this spec only adds the re-parse.)

### `server/src/models/recipe.ts`

- No change needed for C3 — `IngredientDetail` (`:21-27`) and `toPublicIngredient` (`:74-81`) already read/emit `quantity_text`/`amount`/`unit`. The public shape already surfaces these; C3 just makes them non-null in practice.

## Implementation notes (from DESIGN.md)

- **Adapter is the convergence point, not `toRecipeInput`** (DESIGN "Import & persist", Architect M1). The JSON-LD family never reaches the LLM — raw strings only survive up to the `ExtractedRecipe → ExtractedRecipeData` boundary. Parse there.
- **`StructuredIngredient`** = heb-bot's model trimmed to a single `amount`/`unit` (drop grocery-only `searchTerms`/`optional`/`measurements[]`); `amount` is a string to match `numeric` (DESIGN Modules, Architect N-verified).
- **Parser algorithm** (DESIGN Modules → `parse/ingredient.ts`, Architect S4):
  1. Trim `raw`. `quantityText = raw`.
  2. Match a leading quantity token: integer (`2`), decimal (`0.5`), or a **simple fraction** — ASCII `1/2` or a single unicode fraction glyph (`½`, `⅓`, `¼`, `¾` — already in `website.ts` `NAMED_ENTITIES`). A **mixed number** (`1 1/2`), a **range** (`6-8`, `6–8`), or a leading "plus" construction is **ambiguous → bail** (null/null, whole line = name).
  3. If a quantity matched, look at the next token: if it is in the known-unit set (canonical lowercase-singular + abbreviation), consume it as `unit` (canonicalized). Else no unit.
  4. Remainder (after quantity and optional unit) = `name`. If nothing matched at step 2, `name = raw`, `amount = null`, `unit = null`.
- **Known-unit set** (canonical → itself; abbrev → canonical): `cup` (`c`), `teaspoon` (`tsp`), `tablespoon` (`tbsp`), `ounce` (`oz`), `pound` (`lb`), `gram` (`g`), `kilogram` (`kg`), `milliliter` (`ml`), `liter` (`l`), plus the bare canonical singulars. Match case-insensitively and accept a trailing plural `s` (`cups` → `cup`). `large`/`small`/`clove`/etc. are **not** units (so `"3 large eggs"` keeps `large eggs` as the name).
- **Ambiguity is the safety valve.** DESIGN: "anything ambiguous → `amount`/`unit` null, whole line = `name`, `quantityText` preserved." Do not attempt unit-algebra (rejected in DESIGN Decisions, Architect S4).
- **`quantity_text` invariant** (Architect N3): the column is nullable in the DB; `parseIngredientLine` guarantees it is always set for both paths — keep the guard in the parser/adapter only.

## Test cases (offline — never hit the network)

Each acceptance criterion maps to a concrete test.

### Unit — `server/tests/unit/ingredient.test.ts` (new)

`parseIngredientLine` drop/keep table:

| Input | Expected |
|---|---|
| `"2 cups flour"` | `{ name: "flour", amount: "2", unit: "cup", quantityText: "2 cups flour" }` |
| `"1 lb chicken"` | `{ name: "chicken", amount: "1", unit: "pound", quantityText: "1 lb chicken" }` |
| `"3 large eggs"` | `{ name: "large eggs", amount: "3", unit: null, quantityText: "3 large eggs" }` |
| `"1 tbsp plus 1 tsp butter"` | `{ name: "1 tbsp plus 1 tsp butter", amount: null, unit: null, quantityText: "1 tbsp plus 1 tsp butter" }` |
| `"6-8 wings"` | `{ name: "6-8 wings", amount: null, unit: null, quantityText: "6-8 wings" }` |
| `"salt to taste"` | `{ name: "salt to taste", amount: null, unit: null, quantityText: "salt to taste" }` |
| `"½ cup sugar"` | `{ name: "sugar", amount: "½" (or "0.5"), unit: "cup", quantityText: "½ cup sugar" }` |

- Assert `quantityText === input` on every row.

### Unit — extend `server/tests/unit/parse-providers.test.ts`

- `StubExtractor.extract` returns `ingredients` as a `StructuredIngredient[]` of length 1 with `quantityText` set (covers "stub returns structured").
- (Do not assert the DeepSeek network path — offline only.)

### Unit — `server/tests/unit/import-pipeline.test.ts` (extend)

- `toExtractedData(StubWebsiteFetcher.FIXTURE, { confidence: 1 })` → `ingredients` is `StructuredIngredient[]` of length 3, each with `quantityText` equal to the original fixture string; parseable lines (`"2 chicken breasts"`) carry a non-null `amount`.
- `stripSectionLabels` on a structured list containing a `.quantityText === "For the sauce"` item drops that item and keeps the rest (and is a no-op if it would empty the list).

### Integration — `server/tests/integration/parse-persist.test.ts` (extend)

- After `RecipeRepository.persist(RECIPE, userId)` where `RECIPE.ingredients` is now `StructuredIngredient[]` (e.g. `parseIngredientLine("2 cups flour")`), select the `ingredients` rows and assert the row for `"2 cups flour"` has `amount === "2"`, `unit === "cup"`, `quantity_text === "2 cups flour"`.
- A full import through the stub website fetcher (`StubWebsiteFetcher.FIXTURE` via the adapter) persists rows whose `quantity_text` matches the fixture strings and whose parseable rows carry non-null `amount`/`unit`.

## Out of scope

- Any DB migration (columns already exist).
- Unit-algebra, range math, "plus"-clause combining, or unit **conversion** (Architect S4 — explicitly rejected).
- The `nutrition` field on `ExtractedRecipe`/`mapRecipe` and nutrition compute (C5 — spec-05).
- The C4 servings estimate at `toRecipeInput` (spec-04).
- Ownership / 404 changes in `RecipeService.update`/`remove` (C6 — spec-07); this spec only adds the `parseIngredientLine` re-parse to `update`.
- Scaling math (pure multiplication in the client; no food DB) — noted out of scope in DESIGN.
- Changing the wire contract of `PATCH /v1/recipes/:id` (`updateRecipeSchema` stays `ingredients: string[]`).
