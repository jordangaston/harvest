# Meal Planning — Reference Analysis (CLARIFY gate)

Sources: `~/Desktop/Business/Harvest/meal-plan-details.MP4` (39s Recime walkthrough, 1fps frames)
and `~/Desktop/Business/Harvest/display-meal-in-meal-plan.PNG`. Grounded against our live schema
(`server/src/db/schema/`), routes (`server/src/api/app.ts`), and the mobile stub
(`app/(app)/meal-plan.tsx`).

## The Recime flow (what to emulate)

**Week view** (`My Meal Plan`)
- Header: title + `…` overflow (top-right).
- Week strip: `‹ 03 Aug 2026 – 09 Aug 2026 ›` — arrows page the window ±7 days. Weeks are
  **Monday-start** (Mon 3 … Sun 9). Label is the Mon–Sun date range.
- One section per day: day header (`Monday 3`) + a `+` button. Empty day → muted `No recipes yet`.
- **Current day** highlighted: `Today • Friday 7` in the accent colour; its header also carries a `…`.
- A day with recipes lists rows: **thumbnail + recipe title + a coloured meal chip**
  (Breakfast/Lunch/Dinner/Snack). The same recipe can appear in multiple slots (PNG shows Maple Soy
  Chicken as both Breakfast and Lunch).
- A floating `+` FAB (bottom-right) and an `Add to groceries` button above the day list.
- Bottom tab: Recipes / Meal Plan / Groceries / Discover (already wired in `app/(app)/_layout.tsx`).

**Add-a-recipe flow**
1. Tap `+` on a day → small **context menu**: Breakfast / Lunch / Dinner / Snack (each iconed).
2. Pick a meal → **`Add to <Meal>` bottom sheet** (near-full-height):
   - Tabs: `Choose recipes` | `Add note`.
   - `Search recipes` bar.
   - Filter chips: `Tags ▾` · `Ingredients ▾` · `Total time ▾`.
   - A grid of **cookbook tiles** — `All recipes` (1 Recipe) and each real cookbook (`Mains`, 1 Recipe),
     with cover art + recipe count. Tap a cookbook → drill into its recipes → tap a recipe to assign.
3. `Ingredients ▾` → `Filter by ingredients` sheet: `What's in your pantry?` search + a **Popular grid**
   of ~28 common ingredients with painterly icons (Chicken, Egg, Pasta, Rice, Beef Mince, Broccoli,
   Tofu, Salmon, Spinach, Milk, Quinoa, Canned Tomato, Pork, Beef, Lamb, Mushroom, Potato, Tomato,
   Noodles, Green Beans, Lentils, Chickpea, Flour, Peas, Corn, Cheese, Chicken Stock, Ginger…) + `Apply`.
4. `Total time ▾` → sheet with radio buckets `Under 15 mins` / `Under 30 mins` / `Under 60 mins` +
   `Clear` / `Apply`.
5. `Tags ▾` → `Select tags` sheet (empty in the video — "To add tags, open a recipe and tap Edit").

**View / open / remove**
- Tap an assigned recipe row → opens the recipe card.
- Remove happens per-row (swipe / row menu) and a deleted recipe drops out of every plan.

**From the recipe screen** (per brief, not in the video): an `Add to meal plan` entry opens the *same*
sheet with the recipe pre-chosen.

## Where our build diverges from Recime

- **Design system.** Recime is pure-white. We use golden-hour tokens: sheet = `bg-cream`, rows/tiles =
  `bg-card`, selected = `bg-brand-light`/`border-brand`. Meal chips get token tints, not Recime's
  blue/yellow. Sheets use `Modal animationType="slide"`; honour Reduce Motion (`lib/motion.ts`).
- **Tags filter — drop it.** We have no tag concept in the schema (Cleanup didn't add one) and the brief
  omits it. Ship Ingredients + Total time only.
- **Add note tab — drop it.** Not in the brief; no note field anywhere in our model.
- **Add to groceries button — out of scope here.** It belongs to the Grocery Lists Wave-2 task; we leave
  the placement, they wire the action.

## Grounding against our code (verified)

- `app/(app)/meal-plan.tsx` is a **static stub** — hardcoded `DAYS`, dead arrows/FAB, no data. Full build.
- `recipes.total_minutes` **exists** → the total-time filter is backed. Recipes with `null` total_minutes
  fall out of any active bucket.
- `ingredients` are **free-text `name`** (+ optional painterly `icon` key) with **no catalog FK** → the
  "common ingredients" picker needs a curated list; filtering matches recipe `ingredients.name`.
- **`GET /v1/recipes` (list) is NOT exposed** — only `/v1/recipes/:id`, PATCH, DELETE. `RecipeRepository`
  has `listOwned`. The add sheet's "All recipes" needs a new cursor-paginated list endpoint.
- **No meal-plan table exists** — new schema + migration + repository + routes required.
- Recipes cascade-delete their `ingredients` (`onDelete: 'cascade'`); mirror that for meal-plan entries so
  a deleted recipe leaves all plans automatically (single DB chokepoint).

## Defaults I'm taking (no founder question needed)

- Total-time buckets exactly as Recime (`<15` / `<30` / `<60`, single-select); `null` total_minutes excluded.
- Deleted-recipe removal via FK `meal_plan_entries.recipe_id → recipes.id ON DELETE CASCADE`.
- Remove an assigned recipe via swipe-to-delete on the row (no confirm; re-add is trivial).
- Week navigation unbounded (any past/future week).
- Meal enum fixed to the four values; a new pg enum `meal_slot`.
