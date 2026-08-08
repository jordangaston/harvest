# Grocery Lists — clarifying questions (each with my recommended answer)

**Q1. Is "Order online" (Instacart / Walmart store picker) in scope for this task?**
The Grocery Lists task description covers only add / view / sort — it never mentions ordering; ReciMe shows it,
but heb-bot (H-E-B ordering) and the Wave-3 Serverless Spike are the ordering path.
→ **Recommend: OUT of scope.** Keep the existing static "Order online → Choose store" stub as-is (Instacart/Walmart,
non-functional "Continue to store"); defer real ordering to Wave 3. Build add/view/sort only.

**Q2. What is the source for common-ingredients, aisle mapping, and per-ingredient default unit?**
heb-bot has no aisle model and the USDA catalog was punted, so none of these have a source today.
→ **Recommend: one small curated static catalog in-repo**, extending the proven `server/src/parse/icons.ts`
pattern — each entry `{ canonicalName, aisle, defaultUnit, iconKey }`, ~80–120 common ingredients. It powers the
common-ingredients picker, the default unit, and aisle assignment. No runtime LLM. Unknown ingredients (typed or
from a recipe) fall back to aisle **Other** and their existing keyword-mapped icon.

**Q3. Confirm the fixed aisle taxonomy (and that it's a store-walk sort order).**
→ **Recommend** a `grocery_aisle` pg enum, ordered as a store walk:
`produce · meat_seafood · dairy_eggs_fridge · bakery · pantry · herbs_spices · frozen · beverages · household · other`.
Display labels match ReciMe ("MEAT & SEAFOOD", "DAIRY, EGGS & FRIDGE", …). `other` is the final catch-all.

**Q4. Grocery data model — single global list per user, with source tracking?**
→ **Recommend: one list per user**, one `grocery_items` table: `user_id, name, amount(numeric,null), unit(null),
quantity_text(null), aisle(enum), icon, checked(bool), source_recipe_id(null), position, created_at`.
`source_recipe_id` (null = manually added) is what powers the "by recipe" sort. No separate "lists" entity.

**Q5. What exactly is "quantity smart-typing (Todoist-like), sensible default per ingredient"?**
→ **Recommend:** the manual-add field parses inline — a leading quantity/unit is peeled off as you type
("2 cups flour" → amount 2, unit cup, name "flour"). If no quantity is typed, default **qty 1 + the catalog's
default unit** for that ingredient (e.g. eggs→count, milk→carton, flour→cup); unknown ingredient with no typed
unit → name only (no amount). One field, parse-on-add — no separate quantity stepper on the manual path.

**Q6. Serving-scaling of recipe ingredients + unscalable rows + rounding.**
→ **Recommend:** scale `amount` linearly by `chosenServings / recipe.servings`, rounded to the nearest ¼ and shown
as a fraction; rows with null `amount` (only `quantity_text`, e.g. "a pinch") are added unscaled with their text.
If `recipe.servings` is null, hide the stepper and add ingredients as-is.

**Q7. When an ingredient already on the list is added again, merge or append?**
(Manual repeat, or a recipe adds "soy sauce" you already have.)
→ **Recommend: merge by normalized name + compatible unit → sum the amounts**; incompatible/unknown unit → keep a
separate line. (Simplest fallback if you'd rather: always append, never merge.)

**Q8. Checked-item behavior while shopping.**
→ **Recommend minimal:** tapping the checkbox strikes through + dims the row and sinks it to the bottom of its
aisle group; state persists. Defer any bulk "clear checked" to a follow-up. (Confirm you don't want checked items
auto-deleted instead.)

**Q9. Confirm the three sort modes + how "by recipe" groups manual items.**
Brief: sort by **aisle** (default) / **recipe** / **A–Z**.
→ **Recommend:** "by recipe" groups items under the recipe they came from, with manually-added items under an
**"Added manually"** group; A–Z is a flat alphabetical list; aisle is the default grouped view.
