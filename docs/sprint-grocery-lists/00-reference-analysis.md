# Grocery Lists — reference analysis (CLARIFY gate)

Reference: `add-to-groceries-list-details.MP4` + `recipes-details.MP4` (ReciMe, the app Harvest emulates).
Frames extracted 1fps; verified against live schema (`server/src/db/schema/`), `server/src/parse/icons.ts`,
and `~/workspace/heb-bot`.

## What ReciMe does (the behaviors to emulate)

### Grocery List screen
- Header: **"Grocery List"**, an **"N items"** count, share + `…` icons, and an **"Aisle ⌄" sort dropdown** (top-right).
- **"Order online"** outlined button under the header.
- Items **grouped by aisle** under coloured section headers seen in the video: **MEAT & SEAFOOD**,
  **DAIRY, EGGS & FRIDGE**, **HERBS & SPICES**. Each row = painterly ingredient icon + name + a right-side **checkbox**.
- A single global list per user (no multiple named lists).
- **FAB (+)** → **"Add to Groceries"** bottom sheet: one free-text field *"Type or paste multiple ingredients"* +
  **Done**; typing shows an inline **Add**. Added item lands in its aisle group with an auto-resolved icon.
  (ReciMe shows **no** common-ingredient picker and **no** quantity field here — see Divergences.)
- **Order online** → **"Select items"** (aisle-grouped checklist) → **Next** → **"Choose store"**
  (Instacart / Walmart, *"Don't see your store? Tell us here"*) → **Continue to store**.

### Add from the recipe screen
- Recipe detail toolbar row: **Meal Plan · Groceries · Pin · Share**. Tapping **Groceries** opens an **"Add items"** sheet:
  - **servings stepper** (`− 4 + servings`) + a **Convert** button (unit metric/imperial — a ReciMe Plus feature).
  - **INGREDIENTS** header + **Deselect all**; every ingredient row = icon + **bold amount+unit** + name + checkbox (all checked).
  - Primary **"Add 13 items"** button; count tracks the checked rows.
- After adding: returns to the recipe (brief specifies a confirmation **toast** "Added X items to grocery list — tap to view").

## Live-code facts that shape our build
- **Recipe ingredients are already structured** (Cleanup): `ingredients{ name, amount(numeric,null), unit(null),
  quantity_text(null), icon }`. So serving-scale = `amount × chosen/recipeServings`; rows with null `amount`
  (e.g. "a pinch") can't scale — add unscaled with `quantity_text`.
- **`recipes.servings`** (int, nullable) + `servings_estimated` exist → the stepper's base.
- **Icons already solved**: `server/src/parse/icons.ts` = deterministic keyword→icon-key map (~60 ingredients),
  mirrored by the app's painterly set (`components/recime/recipes.ts`). Reuse for typed/common items too.
- **No grocery table exists server-side** — greenfield (`grocery_items`).

## Where we MUST diverge / decide (no existing source)
- **heb-bot has NO aisle/department model** (confirmed: `products/orders/order_items` only). It *does* have the
  ingredient/measurement model (`normalizeIngredients.ts`: LLM → `{searchTerms, measurements[{quantity,unit}], optional}`)
  and a curated **pantry-staples** set (`pantry.ts`). Useful as prior art, not as an aisle source.
- **USDA food catalog was punted in Cleanup** → no aisle grouping, no common-ingredient list, no per-ingredient
  default unit from there either. All three need a **new source** (see clarify Q2/Q3).
- ReciMe's manual-add is dumb free-text; the brief wants a **common-ingredients picker + search + quantity
  smart-typing (Todoist-like) + sensible per-ingredient default** — a deliberate Harvest upgrade (Q5).
- **Order-online** is shown by ReciMe but is **absent from the Grocery Lists task description** (add/view/sort only)
  — scope decision (Q1).

## Coordination flag (for the coordinator, not the founder)
Both **Meal Planning** and **Grocery Lists** add an action to the **recipe detail screen** (Add-to-meal-plan vs.
Add-to-groceries). The recipe-detail host + its toolbar are shared surface — the two waves must not collide there.
