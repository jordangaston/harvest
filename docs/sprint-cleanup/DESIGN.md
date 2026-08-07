---
tags: [harvest, cleanup], tdd
summary: "Wave-1 Cleanup technical design — C1 hide Discover, C2 onboarding enum columns, C3 structured ingredients, C4 servings estimate, C5 Nutrition-Facts label, C5a in-memory USDA food catalog, C6 recipe ownership"
locked: false
---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | approved | Approve-with-changes; all must-fixes (M1–M5), should-fixes (S1–S4), and nits (N1–N3) folded into Revision 2. |
| Founder | approved | Final decisions provided (nutrition label-core, onboarding enums, in-memory catalog, Q-01…Q-05) — incorporated. |

Design only — no code, migrations, or seeding. Every claim was read against live code in this worktree
(paths + line numbers cited). Sub-story IDs (C1–C6, C5a) are the founder's; existing operation IDs from code
comments are referenced where relevant (O-06 extraction, O-08 save, O-09 icons).

Binding docs honoured: `server/CLAUDE.md` (migrations-only, classes with `static create()`, Zod-at-boundary,
one chokepoint, tests never hit the network, shared ownership = canonical entity + join), `AGENTS.md` (no
`bg-white`; sheets `bg-cream`, rows `bg-card`; `lib/motion.ts` tokens), `docs/harvest-principles.md` (fix at
the single chokepoint; transforms never destroy good data; underwhelm the reader).

**Read this first.** C1 is a one-line prop. C3 needs **no migration** — its columns already exist. C6 is the
ownership refactor. **C5 + C5a (nutrition + USDA catalog) is the largest and riskiest piece by far**, and its
whole risk is generic-name → USDA match accuracy — contained by a curated seed, a bounded density fallback,
and a coverage floor. Two live facts drive the design: the mobile app collects onboarding into local
`useState` and **POSTs nothing** today (C2 must add an accumulator and own the POST wiring this sprint); and
the JSON-LD ingredient path **never reaches the LLM**, so structured parsing happens at the
`ExtractedRecipe → ExtractedRecipeData` adapter, not at `toRecipeInput`.

---

# Use Case Implementations

## Import & persist a recipe — Implements C3, C4, C5 (extends O-06/O-08)

Ingredients reach `ExtractedRecipeData` two ways: the **LLM extractor** returns structured ingredients
directly; the **JSON-LD family** (website + outbound links + Pinterest/`pin.recipe`) is promoted from
`ExtractedRecipe` to `ExtractedRecipeData` through one **`toExtractedData` adapter**, which runs the
deterministic `parseIngredientLine`. That adapter — not `toRecipeInput` — is the real convergence point for
raw strings (Architect M1).

~~~mermaid
sequenceDiagram
    participant P as ImportPipeline
    participant X as RecipeExtractor (LLM)
    participant W as WebsiteFetcher (JSON-LD)
    participant AD as toExtractedData (adapter)
    participant T as toRecipeInput (chokepoint)
    participant N as NutritionService
    participant FC as FoodCatalog (in-memory)
    participant R as RecipeRepository

    alt media / caption source
        P->>X: extract(ctx)
        X-->>P: ExtractedRecipeData {ingredients: Structured[], nutrition?}
    else JSON-LD source (Tier-0, free, no LLM)
        P->>W: fetch(url)
        W-->>P: ExtractedRecipe {ingredients: string[], nutrition?}
        P->>AD: toExtractedData(structured, {confidence:1})
        note over AD: C3 — parseIngredientLine(raw) per line (minimal, ambiguous→null)<br/>S2 — carry nutrition through
        AD-->>P: ExtractedRecipeData {ingredients: Structured[]}
    end

    P->>T: toRecipeInput(data, input)
    note over T: strip ingredient section-labels by .quantityText; steps by string<br/>C4 — servings null → 4, servings_estimated=true

    alt nutrition present (C5 parsed)
        note over T: nutrition_source = 'parsed'
    else absent (C5 computed)
        T->>N: compute(ingredients, servings)
        loop each ingredient
            N->>FC: matchFood(name) → toGrams(amount, unit, food)
            FC-->>N: 8 label-core nutrients × grams, or null (logged)
        end
        alt matched fraction ≥ 0.6
            N-->>T: per-serving label-core (partial ok), source='computed'
        else < 0.6
            N-->>T: null (nutrition_source = null)
        end
    end

    P->>R: persist(RecipeInput, userId)
    note over R: C6 — sets recipes.user_id = userId (no saved_recipes row)<br/>C3 — insertIngredients writes name/amount/unit/quantity_text
    R-->>P: recipeId
~~~

## Edit / delete a recipe (ownership) — Implements C6

Copy-on-write is deleted; the owner (`recipes.user_id`) edits in place. Non-owner → **404** (don't leak
existence; Architect N1). Reads stay open. The PATCH edit path re-runs `parseIngredientLine` on edited lines,
so editing does not strip scalability (Architect M2).

~~~mermaid
sequenceDiagram
    participant C as Client
    participant A as Fastify route
    participant S as RecipeService
    participant R as RecipeRepository

    C->>A: PATCH /v1/recipes/:id {ingredients?: string[], steps?}
    A->>S: update(userId, id, edit)
    S->>R: findOwner(id)
    R-->>S: user_id
    alt user_id != caller (or unknown id)
        S-->>C: 404 NotFound
    else owner
        note over S: parseIngredientLine on edit.ingredients (M2)
        S->>R: updateContent(id, {ingredients: Structured[], steps})
        note over R: edit in place — no clone, no repoint;<br/>replaceIngredients writes the 4 columns
        R-->>S: id (unchanged)
        S-->>C: 200 {recipe}
    end
~~~

## Signup with onboarding — Implements C2

Cleanup owns the `POST /v1/users` wiring this sprint (columns + accumulator + send) against the current
user-creation; Wave-2 Phone Auth swaps in the real phone later (resolves Architect S1). The accumulator holds
the display-label → enum-value map and sends enum values.

~~~mermaid
sequenceDiagram
    participant O as Onboarding screens
    participant M as lib/onboarding.ts (accumulator + label→enum map)
    participant A as POST /v1/users
    participant U as UserService
    participant DB as users table

    loop each screen
        O->>M: set(field, label) → stores enum value
    end
    O->>A: {user: {phone_number, onboarding: {goals: enum[], age: enum, …}}}
    A->>U: createUser({phone, onboarding})
    U->>DB: insert enum / enum[] columns + onboarding_completed_at = now()
~~~

---

# Entities

~~~mermaid
classDiagram
    class User {
        +string phone
        +Goal[] goals
        +RecipeSource[] recipeSources
        +Weekday[] cookDays
        +WhenCook whenCook
        +CookTime cookTime
        +HowHeard howHeard
        +AgeBand age
        +datetime onboardingCompletedAt
    }
    class Recipe {
        +string title
        +SourceType sourceType
        +int servings
        +bool servingsEstimated
        +string calories
        +string gramsOfFat
        +string gramsOfSaturatedFat
        +string gramsOfCarbohydrate
        +string gramsOfFiber
        +string gramsOfSugar
        +string gramsOfProtein
        +string milligramsOfSodium
        +NutritionSource nutritionSource
    }
    class Ingredient {
        +string name
        +string amount
        +string unit
        +string quantityText
    }
    class Cookbook {
        +string name
    }
    class CookbookEntry {
    }
    class Food {
        +string name
        +string[] aliases
        +LabelCore per100g
        +Portion[] portions
    }

    User "1" --> "*" Recipe : owns (user_id)
    Recipe "1" --> "*" Ingredient : composition
    User "1" --> "*" Cookbook : owns
    Cookbook "1" --> "*" CookbookEntry : cookbook_recipes
    CookbookEntry "*" --> "1" Recipe : references (shared)
~~~

- **`Recipe.user_id` = the one creator/editor.** Shared *saving* is the `cookbook_recipes` join
  (`CookbookEntry`). A single owner column plus a join table is exactly `server/CLAUDE.md`'s "shared
  ownership = canonical entity + join" — one creator (column), many savers (join). Not a contradiction. A
  future "save someone else's recipe" is a `cookbook_recipes` row on a recipe you don't own; the schema
  already allows it — not built now.
- **Macro fields are strings** (pg `numeric` deserializes to string, matching `RecipeSchema.confidence` and
  `PublicRecipe.amount`; Architect S3).
- **`Food` is an in-memory value object** loaded from a bundled file — **not a table** (founder). It serves
  only the import compute path transiently; it never backs a read query.
- Onboarding fields are **enum / enum[]** value objects (founder), listed under Tables.

---

# Tables

## recipes — changes (C4, C5, C6)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| user_id | uuid | not null, fk → users(id) | **new** — creator/owner; edit rights |
| servings_estimated | boolean | not null, default false | **new** — true when we estimated |
| calories | numeric | | **new** — per serving |
| grams_of_fat | numeric | | **new** — per serving |
| grams_of_saturated_fat | numeric | | **new** |
| grams_of_carbohydrate | numeric | | **new** |
| grams_of_fiber | numeric | | **new** |
| grams_of_sugar | numeric | | **new** |
| grams_of_protein | numeric | | **new** |
| milligrams_of_sodium | numeric | | **new** |
| nutrition_source | nutrition_source (enum) | | **new** — `parsed` \| `computed`; null = unknown |

The eight nutrient columns are the **Nutrition-Facts label core** (founder), per serving, modelled
string-nullable in Zod (`z.string().nullable()`) to match the `numeric` convention. Index `recipes_user_idx`
on `(user_id, created_at desc)` backs `listOwned`. Delete the stale comment `recipes.ts:5-6` ("ownership
lives in `saved_recipes`"; Architect N2).

## users — changes (C2)

Drop `onboarding jsonb`. Add enum / enum[] columns (all nullable — a user may skip a screen) +
`onboarding_completed_at timestamptz`. Display labels map to stable snake_case enum values, so re-wording a
label needs no migration; only add/remove of an option does.

| Column | Type | Enum type | Cardinality |
|---|---|---|---|
| goals | goal[] | `goal` | multi |
| recipe_sources | recipe_source[] | `recipe_source` | multi |
| cook_days | weekday[] | `weekday` | multi |
| when_cook | when_cook | `when_cook` | single |
| cook_time | cook_time | `cook_time` | single |
| how_heard | how_heard | `how_heard` | single |
| age | age_band | `age_band` | single |
| onboarding_completed_at | timestamptz | — | — |

**Enum types + label→value map** (read from `app/(onboarding)/`; labels stored in the mobile accumulator):

| Enum | Screen | value ← label |
|---|---|---|
| `goal` | `goals.tsx:7-15` | `eat_healthier`←Eat healthier · `save_money`←Save money · `improve_cooking`←Improve cooking skills · `organize_recipes`←Organize recipes · `plan_meals`←Plan out meals · `meal_prepping`←Meal prepping · `try_new_cuisines`←Try new cuisines |
| `recipe_source` | `recipe-sources.tsx:19-41` | `social_media`←Social media · `recipe_websites`←Recipe websites · `printed_handwritten`←Printed/handwritten recipes |
| `weekday` | `cook-time.tsx:7` | `mon`·`tue`·`wed`·`thu`·`fri`·`sat`·`sun` |
| `when_cook` | `when-cook.tsx:7-13` | `morning_plan_ahead`←In the morning… · `lunchtime`←Around lunch time… · `evening_ready`←In the evening… · `weekly_schedule`←Once a week… · `meal_prep`←I meal prep |
| `cook_time` | `cook-time.tsx:8` | `before_5pm`←Before 5 PM · `from_5_to_6pm`←5 – 6 PM · `from_6_to_7pm`←6 – 7 PM · `from_7_to_8pm`←7 – 8 PM · `after_8pm`←After 8 PM |
| `how_heard` | `how-heard.tsx:15-26` | `tiktok`·`google_search`·`youtube`·`instagram`·`pinterest`·`email_newsletter`·`app_store_search`·`facebook`·`friend`←Through a friend·`other` |
| `age_band` | `age.tsx:7` | `under_24`←24 and under · `from_25_to_34`←25-34 · `from_35_to_44`←35-44 · `from_45_to_54`←45-54 · `over_55`←55+ |

`createUserSchema` (`api/schemas.ts:11-16`) replaces `onboarding: z.unknown()` with a typed object whose
fields are `z.array(z.enum([...]))` / `z.enum([...])` mirroring the pg enums.

## ingredients — no change (C3)

Already has `name`, `quantity_text` (nullable), `amount numeric`, `unit text`, `icon`
(`schema/ingredients.ts`). C3 only **populates** the three currently-null columns; no migration. The
"never-null `quantity_text`" rule is a code invariant (the column is nullable), enforced in
`parseIngredientLine`/the adapter for both paths (Architect N3).

## cookbooks / cookbook_recipes — existing, minimal Cleanup change

Documented for completeness; both tables already exist. **The only Cleanup change** is dropping the
`savedRecipes` insert in `cookbook-repository.setMembership` (`:120`) and correcting the stale
"ownership lives in `saved_recipes`" comments (`cookbooks.ts:5-7`, `cookbook-recipes.ts`).

`cookbooks` (`schema/cookbooks.ts`): `id uuid pk`, `user_id uuid not null fk→users on delete cascade`,
`name text not null`, `created_at timestamptz`. Unique `(user_id, name)`; index `(user_id, created_at desc)`.

`cookbook_recipes` (`schema/cookbook-recipes.ts`): `id uuid pk`, `cookbook_id uuid not null fk→cookbooks on
delete cascade`, `recipe_id uuid not null fk→recipes on delete cascade`, `created_at timestamptz`. Unique
`(cookbook_id, recipe_id)`; index `(cookbook_id, created_at desc)`. This is the save mechanism / CookbookEntry.

## saved_recipes — DROP (C6)

Drop the table and both indexes (`saved_recipes_user_recipe_uidx`, `saved_recipes_user_idx`). Remove
`schema/saved-recipes.ts`, its re-export (`schema/index.ts:4`), and the `SavedRecipe`/`NewSavedRecipe` types.
Destructive is fine (pre-launch, no data, no backfill). Migration 0006 assumes `recipes` is empty (adds
`user_id NOT NULL`, no default) — true pre-launch; it will drop a populated dev/staging DB rather than fail
mid-migrate, so wipe such an env, don't debug it (Architect risk 4).

## No food tables

Per founder, the food catalog is **in-memory from a committed file** — there are **no `foods`/`food_portions`
tables, no `pg_trgm`, and no migration 0009**. See Deployment → Food catalog.

---

# Modules

~~~mermaid
classDiagram
    class RecipeExtractor {
        <<interface>>
        +extract(ParseContext) ExtractedRecipeData
    }
    class DeepseekExtractor
    class StubExtractor
    class FoodCatalog {
        +static create() FoodCatalog
        +matchFood(name) Food?
        +toGrams(amount, unit, Food) number?
    }
    class NutritionService {
        +compute(StructuredIngredient[], servings) LabelCore?
    }
    class RecipeRepository {
        +persist(RecipeInput, userId) string
        +findOwner(id) string?
        +updateContent(id, StructuredIngredient[], steps) string
        +deleteOwned(userId, id) bool
        +listOwned(userId) Recipe[]
    }
    RecipeExtractor <|.. DeepseekExtractor
    RecipeExtractor <|.. StubExtractor
    NutritionService --> FoodCatalog : depends on
~~~

~~~mermaid
flowchart LR
    W[WebsiteFetcher ExtractedRecipe] -->|string[] + nutrition| AD[toExtractedData adapter]
    AD -->|raw line| PIL[parseIngredientLine]
    PIL -->|StructuredIngredient| AD
    X[LLM Extractor] -->|StructuredIngredient[] + nutrition| T[toRecipeInput]
    AD -->|ExtractedRecipeData| T
    T -->|StructuredIngredient[] + servings| N[NutritionService]
    N -->|name / amount+unit| FC[FoodCatalog in-memory]
    T -->|RecipeInput| R[RecipeRepository]
~~~

Key module changes:

- **`fetch/website.ts`** — `ExtractedRecipe.ingredients` **stays `string[]`** and `StubWebsiteFetcher.FIXTURE`
  is unchanged; `mapRecipe` stays a pure string extractor. **Decision (Architect M1):** the **adapter** parses,
  not `mapRecipe`. `mapRecipe` gains one thing — a **`nutrition` field** parsed from schema.org
  `NutritionInformation` (Architect S2): `calories`, `fatContent`, `saturatedFatContent`,
  `carbohydrateContent`, `fiberContent`, `sugarContent`, `proteinContent`, `sodiumContent` → the label core,
  strings with the number stripped. Add `nutrition?` to the `ExtractedRecipe` interface (`:11-21`).
- **`toExtractedData(structured, extras)` (new, in `import-pipeline.ts`)** — the single
  `ExtractedRecipe → ExtractedRecipeData` promotion. Runs `parseIngredientLine` on each raw ingredient string
  and carries `nutrition` through. Replaces the inline `{ ...structured, confidence: 1 }` spreads; the
  JSON-LD sources that feed `material.structured` (website `:91`, outbound `:124`, IG/FB `:211`, TikTok
  `:255`, Pinterest `:242`/`:247`) all promote through it.
- **`parse/ingredient.ts` (new)** — `parseIngredientLine(raw): StructuredIngredient`, **minimal**
  (Architect S4 / Q-02): a leading integer/decimal/simple-fraction → `amount`; a following known unit
  (lowercase-singular set + common abbreviations) → `unit`; the remainder → `name`; `quantityText = raw`. No
  unit-algebra, no "plus"-combining, no range math — **anything ambiguous → `amount`/`unit` null, whole line
  = `name`, `quantityText` preserved.** An unscalable line is honest; a wrongly-combined one is a bug.
- **`parse/extractor.ts`** — extend `SYSTEM_PROMPT` + `toData` so the LLM returns
  `ingredients: StructuredIngredient[]` and an optional `nutrition` label-core block. One network call, no
  second pass (founder). `StubExtractor` returns one structured stub so tests stay offline.
- **`pipeline/import-pipeline.ts` `toRecipeInput`** — still the persist chokepoint: strips ingredient
  section-labels by `.quantityText` (was a `string[]` filter; now filters structured items — Architect M1),
  strips step section-labels unchanged, applies the C4 servings estimate, and sets/threads the C5 nutrition
  source.
- **`services/nutrition-service.ts` (new)** — `compute(ingredients, servings)`: sum matched label-core ×
  grams, divide by servings; unmatched → 0 and logged; **mark `computed` only when matched fraction ≥ 0.6**,
  else return null (Architect M5 / Q-01).
- **`FoodCatalog` (new, `server/src/nutrition/food-catalog.ts`)** — `static create()` loads
  `server/seed/foods.json` **once** (singleton). `matchFood(name): Food | null` follows the **Matching**
  spec below (lexical + alias table + a bounded Dice-bigram fallback — **not embeddings**). `toGrams(amount,
  unit, food)` = weight units direct; volume via the food's own portions; **water-density fallback for
  water-like liquids only** (water/broth/stock/milk/juice); a dry-goods volume with no portion → unmatched
  (Architect M4). `matchFood` is a **swappable interface** (`FoodMatcher`) so the strategy can change without
  touching `NutritionService`.

### Matching (founder-approved: lexical + aliases, NOT embeddings)

`matchFood(name)` runs a deterministic, offline pipeline over the small curated catalog — no model, no
network. Both the ingredient name and every candidate (canonical `name` + `aliases`) are **normalized** the
same way first, then matched in tiers; the first tier that yields a confident hit wins.

1. **Normalize** — lowercase; strip punctuation; drop a descriptor/prep **stop-list**
   (`fresh, chopped, minced, diced, sliced, raw, cooked, large, small, medium, finely, roughly, ground,
   to taste, for garnish, for serving, optional, room temperature, …`); singularize each token (naive
   plural→singular: `tomatoes→tomato`); collapse whitespace.
2. **Exact** — normalized ingredient equals the food's normalized canonical `name` or any normalized
   `aliases` entry. Aliases carry nutrition-identity synonyms: `aubergine↔eggplant`, `cilantro↔coriander`,
   `garbanzo↔chickpea`, `heavy cream↔heavy whipping cream`, `scallion↔green onion`, ….
3. **Head-noun / token-subset** — all of a food's canonical tokens appear in the ingredient's token set
   (`extra virgin olive oil` → `olive oil`); the candidate with the largest token overlap wins.
4. **Bounded fuzzy** — **Sørensen–Dice coefficient on character bigrams**; take the single best candidate
   **only if its score ≥ 0.8**, else null. (Bigram-Dice, not embeddings: it rewards shared spelling, not
   semantic neighborhood — so `cream` scores low against `ice cream` rather than being pulled in as a
   "neighbor.")
5. **No confident match → null** + a `nutrition.unmatched_ingredient` log. The ≥ 0.6 coverage floor
   (`NutritionService`) then decides whether the recipe is `computed` at all.

**Unit-test guardrail (the matcher's contract):** exact hit; alias hit (`aubergine` → eggplant); head-noun
hit (`extra virgin olive oil` → olive oil); plural (`tomatoes` → tomato); prep-stripped (`finely chopped
garlic` → garlic); near-miss → null; and **`"cream"` must NOT match `"ice cream"`** (nutrition identity, not
semantic neighborhood — the Dice-0.8 floor enforces it).
- **`repositories/recipe-repository.ts`** — `persist` sets `user_id`, drops `saveForUser`;
  **`insertIngredients` and `replaceIngredients` now write `amount`/`unit`/`quantity_text`** (Architect M2),
  taking `StructuredIngredient[]`; `updateContent` loses copy-on-write and edits in place;
  `removeForUser` → `deleteOwned`; delete `isSavedBy`, `countSavers`, `cloneRecipe`, `repointUser`,
  `saveForUser`; add `findOwner`, `listOwned`.
- **`services/recipe-service.ts`** — `update` checks ownership via `findOwner` (non-owner → 404) and runs
  `parseIngredientLine` on `edit.ingredients` before `updateContent` (M2). `remove` → `deleteOwned`, 404 if
  not owned.
- **`repositories/cookbook-repository.ts` `setMembership`** — drop the `savedRecipes` insert (`:120`);
  membership is purely `cookbook_recipes`.

`StructuredIngredient` = `{ name: string; amount: string | null; unit: string | null; quantityText: string }`
— heb-bot's model trimmed to a single `amount`/`unit` (drop grocery-only `searchTerms`/`optional`/
`measurements[]`); `amount` is a string to match the `numeric` convention.

---

# APIs

HTTP contracts are unchanged except where noted; internals and authorization change.

## Create user `POST /v1/users`

**Cleanup owns this wiring this sprint.** Carries typed enum onboarding. `createUserSchema` replaces
`onboarding: unknown` with a typed optional object of enum / enum[] fields.

- Body → `user`: `{ phone_number: string, onboarding?: { goals?: goal[], recipe_sources?: recipe_source[],
  cook_days?: weekday[], when_cook?: when_cook, cook_time?: cook_time, how_heard?: how_heard, age?: age_band } }`
- Success `200`: unchanged session payload.

## Edit recipe `PATCH /v1/recipes/:id`

Body/response unchanged (`updateRecipeSchema`: `{ ingredients?: string[], steps?: string[] }`). **Owner-only;
non-owner or unknown id → `404`.** No copy-on-write; the returned id always equals the request id (mobile
drops its fork handling). Edited ingredient lines are re-parsed so scalability survives an edit (M2).

## Delete recipe `DELETE /v1/recipes/:id`

Owner deletes the canonical recipe; `ingredients`, `recipe_steps`, `cookbook_recipes`, `import_job_recipes`
cascade (all FK `recipes` `onDelete: 'cascade'` — Architect-verified). Non-owner or unknown → `404`; `204` on
success.

## Reads

`GET /v1/recipes/:id`, `PUT /v1/recipes/:id/cookbooks`, and the cookbook endpoints are unchanged.
`PublicRecipe` (`models/recipe.ts`) gains `servings_estimated`, the eight label-core macros (strings), and
`nutrition_source`. **`GET /v1/recipes` is not exposed this sprint** — `RecipeRepository.listOwned` is built
(tests use it), but no screen consumes an owned list yet (`app/(app)/recipes.tsx` lists cookbooks; Q-03).

---

# Testing

Offline only — tests never hit the network (`server/CLAUDE.md`). Integration tests run against local Postgres
migrated by `tests/helpers/global-setup.ts`; the LLM/website/vision providers use their stubs. The food
catalog loads a **small committed fixture** `foods.json` — offline by construction, no DB seed, no CSV
download in CI.

## Test Coverage

| Use case | Type | Unit | Integration |
|---|---|---|---|
| C1 hide Discover | nav prop | | (visual check only) |
| C2 onboarding enum columns | Flow | x | x |
| C3 structured ingredients | Op | x | x |
| C4 servings estimate | Op | x | x |
| C5 nutrition parse/compute | Op | x | x |
| C5a catalog match + toGrams | Op | x | |
| C6 ownership / edit-auth | Flow | x | x |

## Test Approach

**Unit.** `parseIngredientLine` (C3, minimal) — `"2 cups flour" → {2, cup, flour}`,
`"1 lb chicken" → {1, pound, chicken}`, `"3 large eggs" → {3, null, "large eggs"}`, and the ambiguous cases
`"1 tbsp plus 1 tsp butter"`, `"6-8 wings"`, and a bare `"salt to taste"` → **`amount/unit null`,
`quantityText` preserved** (no unit-algebra — Architect S4). `FoodCatalog.matchFood` — exact canonical hit,
alias hit, near-miss fuzzy, and a genuine miss → null; `toGrams` — weight direct, volume via portion,
water-like fallback, dry-goods volume with no portion → null (unmatched). `NutritionService` — a fully-matched
recipe → expected per-serving label core; matched fraction ≥ 0.6 → `computed` with unmatched logged;
< 0.6 → null (M5). `mapRecipe` (C5 parsed) — an HTML fixture with a `NutritionInformation` block → parsed
label core, `source='parsed'`. `user-service` (C2) — enum onboarding round-trips (extends the existing
`:57-59` test) and rejects an unknown enum value.

**Integration.** `parse-persist.test.ts` — persisted ingredients carry `amount`/`unit`/`quantity_text` (stub
extractor + `StubWebsiteFetcher.FIXTURE`); no-`recipeYield` recipe → `servings=4, servings_estimated=true`;
`recipes.user_id` set on import (C6). `recipe.test.ts` — drop the CoW fork test; add edit-in-place (edited
lines keep amounts), **non-owner PATCH/DELETE → 404** (Architect N1), delete-by-owner cascades cleanly.
Remove `savedRecipes` clears/imports across `recipe.test.ts`, `cookbook.test.ts`, `parse-persist.test.ts`,
`import.test.ts`, `user-repository.test.ts`, `phone-auth.test.ts`. `scaffold.test.ts` — update the schema
audit: it asserts the `saved_recipes` table (`:36`) and `saved_recipes_user_idx` index (`:46`); replace with
`recipes.user_id` + `recipes_user_idx`, add the new `users` enum types and the `nutrition_source` enum, and
**assert no `foods`/`food_portions` tables and no `pg_trgm`**.

## Test Infrastructure

A small committed **`foods.json` fixture** (~10 curated cooking foods with canonical name, aliases,
label-core per 100 g, and portions) for the matcher/compute unit tests. No DB seed table; no CSV in CI.

---

# Deployment

## Migrations

Drizzle migrations only (`drizzle-kit generate` → `migrate`); destructive OK; no backfill (pre-launch). Next
index is `0006`. **No `0009`** — the food catalog is a bundled file, not a table.

| Order | File | Story | Type | Description | Back-compat |
|---|---|---|---|---|---|
| 1 | 0006 | C6 | schema | `recipes` add `user_id` (not null, fk) + `recipes_user_idx`; **drop `saved_recipes`** (+2 indexes) | no (destructive, intended) |
| 2 | 0007 | C2 | schema | create enums `goal`/`recipe_source`/`weekday`/`when_cook`/`cook_time`/`how_heard`/`age_band`; `users` drop `onboarding jsonb`; add 7 enum/enum[] columns + `onboarding_completed_at` | no |
| 3 | 0008 | C4+C5 | schema | create enum `nutrition_source`; `recipes` add `servings_estimated` + the 8 label-core nutrient columns + `nutrition_source` | yes (additive) |

C3 has **no migration** (columns exist; code-only). No `pg_trgm`, no `foods`/`food_portions`.

## Food catalog (in-memory, offline)

1. A developer downloads the SR Legacy CSV bundle once (`food.csv`, `food_nutrient.csv`, `nutrient.csv`,
   `food_portion.csv`) from https://fdc.nal.usda.gov/download-datasets.
2. `server/scripts/build-foods-seed.ts` (run manually) filters SR Legacy to a **curated cooking subset**
   (Q-05), canonicalizes each food's `name` to the description's head noun, hand-adds an `aliases` list for
   the staples, pulls the eight label-core nutrients per 100 g (FDC ids: calories 1008, protein 1003,
   total fat 1004, carbohydrate 1005, fiber 1079, total sugars 2000, saturated fat 1258, sodium 1093), and
   attaches portion→gram weights — emitting the committed **`server/seed/foods.json`**.
3. At runtime `FoodCatalog.create()` loads that file once (singleton). Nutrition is computed at import and
   stored on the recipe, so the catalog serves the import path only — never a read query. Tests load a small
   fixture subset. Nothing here is a migration.

## Rollback

Each migration is independent and pre-launch; roll back by reverting the code and dropping the added
columns/tables/enums. No data to preserve.

---

# Monitoring

Light — pre-launch cleanup. Two structured logs, each tied to a use case; no dashboards/alerts.

## Logging

| Field / event | Level | Use case | Reason |
|---|---|---|---|
| `nutrition.unmatched_ingredient` (name, recipeId) | info | C5 | Which ingredients the matcher missed — drives alias/threshold tuning; the safety valve behind the coverage floor |
| `nutrition.below_coverage_floor` (recipeId, fraction) | info | C5 | Recipes left `nutrition_source = null` because < 0.6 matched — sizes the accuracy gap |

Low-cardinality, off the hot path. No metrics/alerts warranted before launch.

---

# Decisions

## C5 nutrition = Nutrition-Facts label core, per serving (8 fields), macros as strings

**Framework:** direct criterion — founder's explicit column list and naming.

**Choice:** `calories`, `grams_of_fat`, `grams_of_saturated_fat`, `grams_of_carbohydrate`, `grams_of_fiber`,
`grams_of_sugar`, `grams_of_protein`, `milligrams_of_sodium`, `nutrition_source`. Modelled string-nullable in
Zod to match the `numeric` convention (`RecipeSchema.confidence`; Architect S3). Reverses Revision 1's
four-macro shape.

## C2 onboarding stored as pg enums / enum[], not free text

**Framework:** direct criterion — founder's call (reverses Revision 1's text/text[]).

**Choice:** Each field is a pg enum; multi-selects are `enum[]`. Display copy maps to a stable snake_case
value (`"Eat healthier" → eat_healthier`), so re-wording a label needs no migration; only add/remove of an
option does. The mobile accumulator holds the label→value map and sends enum values. Cleanup owns the
`POST /v1/users` wiring this sprint (resolves the C2/Phone-Auth seam, Architect S1).

### Alternatives considered
- **text/text[] (Revision 1):** queryable but unconstrained; the founder wants the enum guarantee.
- **jsonb (original):** the thing C2 removes.

## C5a food catalog is in-memory from a bundled file, not DB tables

**Framework:** direct criterion — founder's call.

**Choice:** Commit `server/seed/foods.json` (curated SR Legacy subset: canonical name, aliases, 8 nutrients
per 100 g, portions); a `FoodCatalog` singleton loads it once. **No `foods`/`food_portions` tables, no
`pg_trgm`, no migration 0009.** The clincher: nutrition is computed at import and stored on the recipe, so
the catalog serves the import path transiently and never backs a read query — it shouldn't be a table.

### Alternatives considered
- **DB tables + `pg_trgm` (Revision 1):** a table and an extension for data that never serves a query;
  heavier migration and CI seed for no read-path benefit.

## C3 parse at the `ExtractedRecipe → ExtractedRecipeData` adapter, deterministic and minimal

**Framework:** direct criterion — Architect M1/S4; the JSON-LD path never reaches the LLM.

**Choice:** A single `toExtractedData` adapter runs `parseIngredientLine` at the promotion boundary (five
JSON-LD spread sites), not at `toRecipeInput`. `ExtractedRecipe.ingredients` stays `string[]` (the adapter
parses; `mapRecipe` and the stub are untouched). The parser is minimal: common case only, ambiguous → null +
preserve. Section-label stripping moves to filter structured items by `.quantityText` at `toRecipeInput`.

### Alternatives considered
- **Parse at `toRecipeInput` (Revision 1):** impossible — no raw strings survive there.
- **Flip `ExtractedRecipe` to structured (mapRecipe parses):** touches the stub and more sites; the adapter
  is the lazier single convergence point.
- **Unit-algebra parser (combine "1 tbsp + 1 tsp"):** re-implements the LLM prompt in regex; wrong-combine
  risk. Rejected (S4).

## C5 coverage floor: `computed` only when matched fraction ≥ 0.6

**Framework:** direct criterion — Architect M5 / Q-01.

**Choice:** Gate `nutrition_source='computed'` on ≥ 0.6 of ingredients matched (by count); below it, leave
nutrition null. A confident understatement (missed butter + sugar) is worse than an honest "unknown"; this is
what keeps match misses from shipping as fact.

## C6 owner column, not a saved_recipes-derived owner

**Framework:** direct criterion — founder's model; matches `server/CLAUDE.md` (canonical entity + join).

**Choice:** `recipes.user_id` = owner/edit-rights; `cookbook_recipes` = save/organization; drop
`saved_recipes` and copy-on-write. Non-owner edit/delete → 404. One creator column + a many-saver join is the
convention, not a contradiction.

---

# Open Questions

All resolved by the founder / Architect; kept for traceability.

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | C5 coverage floor for `computed`? | resolved | Yes — mark `computed` only when matched fraction ≥ 0.6 (by count); else null. |
| Q-02 | Website ingredients: deterministic parser or LLM? | resolved | Deterministic parser only, kept minimal (ambiguous → null, preserve `quantityText`; no unit-algebra). |
| Q-03 | Expose `GET /v1/recipes` (owned)? | resolved | Build `listOwned` (tests use it); do **not** expose the endpoint this sprint. |
| Q-04 | C4 estimate — flat `4` or a heuristic? | resolved | Flat `servings=4` + `servings_estimated` flag; keep the `ponytail:` note. |
| Q-05 | C5a seed size? | resolved | A curated cooking subset (not the ~7.8k dump) — enables canonical names + hand-checked aliases (the accuracy lever). |

**Top risks:** (1) **C5/C5a match accuracy is the whole risk surface** — generic-name → USDA matching is
inherently lossy; the curated seed (canonical name + aliases), the bounded density fallback, the coverage
floor, and the unmatched log keep it honest, but expect threshold/alias tuning post-seed. (2) **C3's type
change ripples wide but moves as one unit** — the five spread sites, the `toExtractedData` adapter,
`stripSectionLabels`, both repository insert paths, both stubs, and every persist test; trace them together or
the build fails piecemeal. (3) **Migration 0006 assumes `recipes` is empty** — true pre-launch; it drops a
populated dev/staging DB rather than failing, so wipe such an env, don't debug it.

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-07 | Cleanup Feature Lead | Initial draft (Revision 1) |
| 2026-08-07 | Cleanup Feature Lead | **Revision 2** — folded in founder decisions + Architect review: nutrition → 8-field Nutrition-Facts label core (string-nullable); onboarding → pg enums/enum[] with label→value map + Cleanup owns `POST /v1/users`; food catalog → in-memory `foods.json` (no tables/`pg_trgm`/0009); parser moved to the `toExtractedData` adapter (5 JSON-LD sites) and kept minimal; persist + PATCH-edit write the four ingredient columns; bounded water-density fallback; coverage floor ≥ 0.6; non-owner → 404; added `cookbooks`/`cookbook_recipes` model; traced the C5 parsed path (`mapRecipe` nutrition). |
| 2026-08-07 | Cleanup Feature Lead | **Implement Step 0** — pinned the **Matching** subsection (founder-approved: normalize + stop-list → exact/alias → head-noun/token-subset → Sørensen–Dice bigram ≥ 0.8 → null; swappable `FoodMatcher`; `"cream"` ≠ `"ice cream"` guardrail). Build starts. |
