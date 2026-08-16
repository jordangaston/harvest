---
tags: [grocery-lists], tdd
summary: "Grocery Lists technical design document"
locked: false
---

# Grocery Lists — Design

Built to `WAVE2-DECISIONS.md` (authoritative), `00-reference-analysis.md`, and `01-clarify-questions.md`.
One grocery list per user. A committed `grocery-catalog.json`, built offline from USDA Foundation Foods, drives
aisle, icon, default unit, and the common-ingredients picker. Order-online stays a stub (Wave 3). Scope now
includes generating ~100 new painterly ingredient icons (nano-banana) to cover catalog foods the existing 55 miss.

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Use Cases (this feature)

**Flows**
- **F-G1 — Add an ingredient manually.** `+` → sheet → pick a common ingredient or type free text (Todoist-style
  parse) → item lands in its aisle with an icon and a default quantity.
- **F-G2 — Add a recipe's ingredients from the recipe screen.** Recipe → "Add to groceries" → sheet with a
  servings stepper + a checklist (all checked, Deselect all) → "Add N items" → toast linking to the list.
- **F-G3 — View the list.** Grouped by aisle by default; sort aisle / recipe / A–Z; tap the checkbox to check off
  (strike + sink). A per-user single list.
- **F-G4 — Manage an item.** Edit quantity, delete, and the non-functional "Order online" stub.

**Operations**
- **O-G1 — Resolve ingredient** → `{ aisle, iconKey, defaultUnit }` from the catalog (unknown → `other` + keyword icon).
- **O-G2 — Build `grocery-catalog.json`** from USDA Foundation Foods (offline seed script).
- **O-G3 — Merge** an incoming item into the list by normalized name + compatible unit.
- **O-G4 — Scale** a recipe ingredient's amount by servings (¼ rounding; null-amount rows as-is).
- **O-G5 — Parse** a typed line into `{ amount, unit, name }` (client, Todoist-style).

---

# Use Case Implementations

## F-G1 Add manually — Implements F-G1

~~~mermaid
sequenceDiagram
    participant U as User
    participant Sheet as AddGrocerySheet (mobile)
    participant Parse as parseGroceryLine (lib)
    participant API as POST /v1/grocery_items
    participant Svc as GroceryService
    participant Cat as GroceryCatalog
    participant DB as grocery_items

    U->>Sheet: type "2 cups flour" (or tap a common ingredient)
    Sheet->>Parse: parseGroceryLine(text)
    Parse-->>Sheet: { amount:2, unit:"cup", name:"flour" }
    U->>Sheet: Add
    Sheet->>API: { items:[{ name, amount, unit }] }
    API->>Svc: add(userId, items)
    loop each item
      Svc->>Cat: resolve(name)
      Cat-->>Svc: { aisle, iconKey, defaultUnit }
      note over Svc: unit ??= defaultUnit; quantity_text = null (structured)
      Svc->>DB: O-G3 merge-or-insert
    end
    Svc-->>API: GroceryItem[]
    API-->>Sheet: 201 items
    Sheet-->>U: sheet closes; item appears in its aisle
~~~

## F-G2 Add from recipe — Implements F-G2

~~~mermaid
sequenceDiagram
    participant U as User
    participant RD as RecipeDetail (app/recipe/[id])
    participant AS as AddItemsSheet (mobile)
    participant Scale as scaleIngredient (lib, O-G4)
    participant API as POST /v1/grocery_items
    participant Svc as GroceryService
    participant Toast as Toast

    U->>RD: tap "Add to groceries"
    RD->>AS: open with recipe.ingredients, recipe.servings
    U->>AS: adjust servings / uncheck rows
    AS->>Scale: scale(amount, chosen/recipe.servings) per checked row
    Scale-->>AS: scaled amount (¼) or quantity_text as-is
    U->>AS: "Add N items"
    AS->>API: { items:[{ name, amount, unit, quantity_text, source_recipe_id }] }
    API->>Svc: add(userId, items)  %% O-G1 resolve + O-G3 merge per item
    Svc-->>API: GroceryItem[]
    API-->>AS: 201
    AS-->>Toast: "Added N items to grocery list — tap to view"
    U->>Toast: tap → router.push("/(app)/groceries")
~~~

## F-G3 View & check off — Implements F-G3

~~~mermaid
sequenceDiagram
    participant U as User
    participant G as Groceries screen
    participant API as GET /v1/grocery_items
    participant Sort as groupAndSort (lib)
    U->>G: open Groceries tab
    G->>API: list
    API-->>G: GroceryItem[] (flat)
    G->>Sort: group by sortMode (aisle default | recipe | A–Z)
    Sort-->>G: sections; checked items sink within group
    U->>G: tap a checkbox
    G->>API: PATCH /v1/grocery_items/:id { checked }
    note over G: optimistic strike + sink; reconcile on response
~~~

## O-G2 Build catalog — Implements O-G2 (offline, run once, output committed)

~~~mermaid
sequenceDiagram
    participant Dev as Engineer
    participant Script as scripts/build-grocery-catalog.ts
    participant USDA as FoodData_Central_..._2026-04-30.json (NOT committed)
    participant Icons as mapIngredientIcon
    participant Out as server/seed/grocery-catalog.json (committed)
    Dev->>Script: pnpm build:grocery-catalog
    Script->>USDA: read FoundationFoods[] (~395)
    loop each food
      Script->>Script: canonicalName = first comma-segment, lowercased
      Script->>Script: aisle = CATEGORY_TO_AISLE[foodCategory] ?? other
      Script->>Icons: iconKey = mapIngredientIcon(canonicalName)
      Script->>Script: defaultUnit = AISLE_DEFAULT_UNIT[aisle]
    end
    Script->>Out: write deduped, sorted entries + a small hand-added supplement
    note over Dev,Out: commit grocery-catalog.json; hand-fix the ugly tail
~~~

---

# Entities

~~~mermaid
classDiagram
    class GroceryItem {
        +uuid id
        +string name
        +number amount
        +string unit
        +string quantityText
        +Aisle aisle
        +string icon
        +boolean checked
        +uuid sourceRecipeId
        +int position
    }
    class CatalogEntry {
        +string canonicalName
        +Aisle aisle
        +string defaultUnit
        +string iconKey
    }
    class Recipe {
        +uuid id
        +int servings
    }
    class Ingredient {
        +string name
        +number amount
        +string unit
        +string quantityText
        +string icon
    }
    class User { +uuid id }
    User "1" --> "*" GroceryItem : owns
    GroceryItem "*" --> "0..1" Recipe : sourceRecipe
    Recipe "1" --> "*" Ingredient : has
    CatalogEntry ..> GroceryItem : resolves aisle/icon/unit
~~~

`Recipe`/`Ingredient` are owned by Cleanup (unchanged). `CatalogEntry` is a static JSON asset, not a table.

---

# Tables

## grocery_items (new)

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | pk, default gen_random_uuid() | |
| user_id | uuid | not null, fk users(id) on delete cascade | one list per user |
| name | text | not null | display + merge key (normalized) |
| amount | numeric | null | structured qty; null for freeform rows |
| unit | text | null | singular, lowercase; null = countless/unknown |
| quantity_text | text | null | set only for freeform rows (e.g. "a pinch"); else null |
| aisle | grocery_aisle (enum) | not null | denormalized from catalog; drives grouping/sort |
| icon | text | not null, default 'default' | icon key (mirrors parse/icons.ts) |
| checked | boolean | not null, default false | strike + sink when true |
| source_recipe_id | uuid | null, fk recipes(id) on delete set null | null = added manually; powers "by recipe" sort |
| position | integer | not null, default 0 | manual ordering within a group |
| created_at | timestamptz | not null, default now() | |

**Enum (new):** `grocery_aisle` = `produce · meat_seafood · dairy_eggs_fridge · bakery · pantry · herbs_spices ·
frozen · beverages · household · other` (store-walk order; `other` catch-all).

**FK note:** `source_recipe_id` uses `on delete set null` so deleting a recipe keeps its already-purchased items on
the list (they just lose the "by recipe" grouping). Full account deletion (Profile) explicitly deletes
`grocery_items` before the user row.

## Indices

| Name | Columns | Unique | Why |
|---|---|---|---|
| idx_grocery_items_user | (user_id) | no | list-by-user is the only read path |

Merge (O-G3) queries `WHERE user_id = $1` then matches in memory (a user's list is small); no functional index needed.

---

# Modules

~~~mermaid
classDiagram
    class GroceryService {
        +add(userId, items[]) GroceryItem[]
        +list(userId) GroceryItem[]
        +setChecked(userId, id, checked) GroceryItem
        +update(userId, id, patch) GroceryItem
        +remove(userId, id) void
    }
    class GroceryRepository {
        +listByUser(userId) Row[]
        +findMergeCandidate(userId, name, unit) Row
        +insert(userId, item) Row
        +addAmount(id, delta) Row
        +setChecked(id, checked) Row
        +delete(userId, id) void
    }
    class GroceryCatalog {
        +resolve(name) { aisle, iconKey, defaultUnit }
        +common(query?) CatalogEntry[]
    }
    GroceryService --> GroceryRepository : persists
    GroceryService --> GroceryCatalog : resolve()
~~~

~~~mermaid
flowchart LR
    Sheet[AddGrocerySheet] -->|items| API[/v1/grocery_items/]
    API -->|items| Svc[GroceryService]
    Svc -->|name| Cat[GroceryCatalog]
    Cat -->|aisle,icon,unit| Svc
    Svc -->|Row| Repo[GroceryRepository]
    Repo -->|Row| DB[(grocery_items)]
    Catalog[grocery-catalog.json] -.load at startup.-> Cat
~~~

`GroceryService`/`GroceryRepository`/`GroceryCatalog` are classes with a `static create()` factory (per
`server/CLAUDE.md`). `GroceryCatalog` loads the committed JSON once at module load (no table, no network). Rows are
`GroceryItemSchema.parse`d at the repository boundary. The invariant "resolve aisle/icon + apply default unit +
merge" lives only in `GroceryService.add` — the single chokepoint both the manual and recipe paths route through.

---

# APIs

## List grocery items `GET /v1/grocery_items`

Returns the user's whole list, flat; the client groups/sorts.

### Request
- Headers — authorization: `Bearer <jwt>`

### Success Response `200`
- Body — items: array of GroceryItem `{ id, name, amount, unit, quantity_text, aisle, icon, checked, source_recipe_id, position }`

The list is small and bounded per user, so this endpoint is **not** paginated (a deliberate exception to the
cursor-pagination rule in `server/CLAUDE.md`, noted in Decisions).

## Add grocery items `POST /v1/grocery_items`

Adds one or many items (manual add sends one; recipe add sends many). The server resolves aisle/icon, applies the
default unit when `unit` is absent, and merges per O-G3.

### Request
- Headers — authorization: `Bearer <jwt>`, content-type: `application/json`
- Body — items: array of `{ name: string, amount?: number, unit?: string, quantity_text?: string, source_recipe_id?: uuid }`

### Success Response `201`
- Body — items: array of GroceryItem (the created/merged rows)

### Validation Error Response `400`
- Body — error: `{ code: "VALIDATION", message }` (empty items, blank name)

## Update grocery item `PATCH /v1/grocery_items/:id`

Toggle `checked` or edit `amount`/`unit`.

### Request
- Body — `{ checked?: boolean, amount?: number, unit?: string }`

### Success Response `200` — Body: GroceryItem
### Not Found Response `404` — item not owned by the caller

## Delete grocery item `DELETE /v1/grocery_items/:id`
### Success Response `204` (no body) · **Not Found** `404`

## Common ingredients `GET /v1/ingredients/common`

Serves the committed catalog for the picker (F-G1) and for Meal Planning to consume. Static, so cacheable.

### Request
- Headers — authorization: `Bearer <jwt>`
- Query — `q?` (optional prefix filter)

### Success Response `200`
- Body — ingredients: array of `{ canonicalName, aisle, defaultUnit, iconKey }`

---

# Cross-task interfaces

**I own / expose**
- `grocery-catalog.json` (committed) + the `build-grocery-catalog` script (raw USDA NOT committed).
- `grocery_aisle` pg enum + `grocery_items` table.
- `GET /v1/ingredients/common` — Meal Planning consumes this (or reads the JSON directly; both read the same file).
- The **"Add to groceries" entry point on the recipe screen** (Meal Planning leaves the hook per decisions).

**I consume**
- Cleanup's structured `recipe.ingredients` (`name, amount, unit, quantity_text, icon`) + `recipe.servings` —
  already loaded on the recipe screen via `GET /v1/recipes/:id`. I do **not** need Meal Planning's
  `GET /v1/recipes` list for any grocery flow.
- `mapIngredientIcon` (`server/src/parse/icons.ts`) + the app icon set (`components/recime/recipes.ts`,
  `resolveIcon`) for item icons.

**Shared surface (coordinate with Meal Planning):** the recipe screen (`app/recipe/[id].tsx`) has only an
Edit/Delete `⋯` menu today — no ReciMe-style toolbar. Both Grocery ("Add to groceries") and Meal Planning ("Add to
meal plan") need an entry point here. Proposed: **both become rows in the existing `⋯` menu** — smallest diff, no
new shared component. See Q-01 for the toolbar alternative.

---

# Mobile screens & flows (design system + motion)

**Groceries tab (`app/(app)/groceries.tsx` — replace the stub)**
- `bg-cream` canvas + `<Backdrop />`. Header "Grocery List" (Lora heading), "N items", and an **Aisle ⌄** sort
  control (aisle / recipe / A–Z). "Order online" outlined button (opens the existing Choose-store stub).
- Sections by aisle (default): a small colored aisle header, then rows on `bg-card` — icon + name + quantity +
  right-side checkbox. Checked rows strike + dim and sink to the bottom of their group.
- FAB `+` (bg-brand) opens the Add sheet.

**Add-to-Groceries sheet (F-G1)** — `Modal animationType="slide"`, surface `bg-cream`, rows `bg-card`.
- One input with live Todoist parse; below it, the common-ingredients list (from `/v1/ingredients/common`) filtered
  as you type. Tap a suggestion → adds with its default unit; or type free text and Add.

**Add-items sheet from recipe (F-G2)** — `Modal` slide, `bg-cream`.
- Servings stepper (`− N +`, base `recipe.servings`); INGREDIENTS list with per-row checkbox (all checked) +
  "Deselect all"; amounts scale live (O-G4). Primary "Add N items" (`bg-brand`), count tracks checked rows.

**Toast** — reuse `lib/savedToast.ts` pattern / `lib/motion.ts` `TOAST` (rise 350ms in / 250ms out): "Added N
items to grocery list — tap to view groceries"; tapping routes to the Groceries tab.

**Motion & a11y:** every sheet uses `Modal animationType="slide"` (native slide + scrim); durations/easing from
`lib/motion.ts`; honor Reduce Motion (`AccessibilityInfo.isReduceMotionEnabled()`); no `bg-white`.

---

# Ingredient icon expansion (new scope)

Today `assets/ingredients/` holds **55** painterly icons, wired through `server/src/parse/icons.ts` (keyword →
icon key) and the app's `ICON` map (`components/recime/recipes.ts`, ~57 keys). Catalog foods beyond those 55 fall
back to the branded Harvest-H `default`. The founder greenlit closing that gap by generating **~100 new icons**
via the **nano-banana-2 MCP** (active model `gemini-3.1-flash-image-preview`).

**Approach (generation happens at implementation, not now):**
1. Diff the catalog's `canonicalName`s (O-G2) against existing icon keys → the list of foods that resolve to
   `default`. Rank by frequency and cap the batch at ~100.
2. Generate each icon with one shared style prompt so the set stays visually consistent with the existing 55
   (painterly oil/gouache, golden-hour palette, single centered ingredient, transparent/cream-keyed background,
   1:1). Save 1K PNGs to `assets/ingredients/<key>.jpg` matching the current naming.
3. Wire each new key in **both** maps: add the keyword→key row in `server/src/parse/icons.ts` and the
   `key: require("...")` entry in the app `ICON` map — the two must stay in lockstep (an icon key with no asset
   renders nothing; an asset with no keyword is never resolved).
4. Re-run the catalog build so new entries carry the richer `iconKey` instead of `default`.

**Cost (confirm exact rate before the run):** Flash image ≈ **$0.039/image → ~$4** for 100; Pro tier
(Nano Banana 2 / Gemini 3 Pro Image) ≈ $0.13–0.24/image → **~$13–24**. Active config is Flash, so ~$4 at 1K.
A cheaper ceiling if spend matters: **generate on demand + cache** — resolve `default` at add-time, enqueue a
one-off generation, and only ever pay for icons users actually hit. Recommend the up-front batch (~$4 is trivial
and keeps generation out of the request path); see Q-04.

**Not in this design:** the generation run itself, prompt tuning, and per-icon review — those are implementation
tasks tracked here as a line-item so scope, cost, and the two-map wiring are visible at sign-off.

# Testing (offline — tests never hit the network)

## Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| O-G2 build catalog | Op | x | | |
| O-G1 resolve | Op | x | | |
| O-G3 merge | Op | x (repo) | x | |
| O-G4 scale | Op | x | | |
| O-G5 parse | Op | x | | |
| F-G1 add manual | Flow | | x | |
| F-G2 add from recipe | Flow | | x | |
| F-G3 view/check | Flow | | x | |

## Approach
- **Unit (server, Vitest):** `build-grocery-catalog` against a small USDA fixture (category→aisle, canonicalName,
  defaultUnit, icon, unknown→`other`) — tests the transform, not USDA. `GroceryCatalog.resolve/common`.
  `GroceryService.add` merge logic with a stubbed repository.
- **Unit (mobile):** `parseGroceryLine` (O-G5), `scaleIngredient` (O-G4, incl. null-amount + null-servings),
  `groupAndSort` (aisle order, "Added manually" group, A–Z, checked sink).
- **Integration (local Postgres, migrated by `tests/helpers/global-setup.ts`):** POST add-one + add-many with
  merge; GET list; PATCH checked; DELETE; `GET /v1/ingredients/common`. As few as cover all paths; no network.
- **E2E:** none required this wave (order-online is a stub; no live third party).

## Test infrastructure
- A `grocery_items` factory + a trimmed USDA JSON fixture (~6 foods spanning categories) under `server/tests/`.
- **Icon-map lockstep check:** a unit test asserting every icon key emitted by `parse/icons.ts` (incl. the ~100
  new keys) has a matching asset entry in the app `ICON` map — catches a key added to one map but not the other.

---

# Deployment

## Migrations
| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | Add `grocery_aisle` enum + `grocery_items` table + `idx_grocery_items_user` | yes (additive) |

`drizzle-kit generate` a `0009+` (number will collide with sibling branches — coordinator reconciles at
integration, per decisions). No data migration (`grocery-catalog.json` is a committed asset, not seeded to DB).

## Deploy sequence
Server migration + `grocery-catalog.json` ship together; the mobile screens depend on the endpoints. Single deploy.

## Rollback plan
Additive-only: drop `grocery_items` + the enum to roll back; no existing table is altered, so old code runs fine
against the new schema and vice versa.

---

# Monitoring
Client-side Mixpanel is owned by the Instrumentation task (named domain actions "Grocery Item Added", "Recipe Added
To Groceries" fire from the shared `Button`/action hooks). This feature adds **no** server metrics — every path is
covered by tests and there is no live third-party dependency to watch. (No alerts, dashboards, or new logs.)

---

# Decisions

## Build the catalog from USDA Foundation Foods, committed as JSON (no catalog table)
**Framework:** Direct criterion — founder-mandated source (`WAVE2-DECISIONS.md` #2); remaining choice is table vs.
committed asset.
**Choice:** A committed `grocery-catalog.json` loaded once at startup. It is static reference data (~400 rows) read
on every add and by the picker; a table would add a migration, a seed step, and a query for data that never changes
per request. Committing the JSON also lets us hand-fix USDA's messy descriptions in review (see Risks).
### Alternatives Considered
- **Catalog table seeded from USDA:** rejected — needless migration + seed + query for immutable data.
- **Runtime LLM classification:** rejected — founder chose a static source; adds cost, latency, nondeterminism.

## Manual-add parsing on the client (O-G5), aisle/icon/merge on the server
**Framework:** Direct criterion — where the data is needed.
**Choice:** Live "2 cups flour" feedback must be instant, so parsing is a client util; aisle/icon resolution and
merge need the catalog + DB, so they live in `GroceryService.add` — the one chokepoint both paths share.

## `GET /v1/grocery_items` is not paginated
**Framework:** Direct criterion — bounded data.
**Choice:** A single user's list is small (tens of items); pagination is speculative infra. Documented exception to
`server/CLAUDE.md`'s cursor-pagination rule.

## Expand the icon set up front (~100 icons) vs. on-demand+cache
**Framework:** Fermi ROI.
**Choice:** Up-front batch. Impact: the picker and list show a real painterly icon instead of the Harvest-H
fallback for the long tail of catalog foods — a visible quality win on every grocery screen. Effort/cost: ~$4 at
Flash 1K + a scripted generation run. On-demand+cache saves only the difference between $4 and (fraction of $4),
at the cost of request-path complexity and cold-start `default`s. At this price the batch wins on ROI.
### Alternatives Considered
- **On-demand + cache:** rejected for v1 — real complexity to save trivial spend; keep as the fallback if the
  batch ever balloons (Q-04).
- **Pro tier (Nano Banana 2):** rejected by default — ~5× the cost for icons rendered at 40px; Flash 1K is ample.

## Merge without unit conversion
**Framework:** Direct criterion — cost vs. value.
**Choice:** Merge only same-name + same-unit (sum amounts); different units stay separate lines. A cup↔tbsp
conversion engine is disproportionate for v1. `ponytail:` ceiling — add a converter if users complain.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Recipe-screen entry point: `⋯`-menu rows (my proposal) or a ReciMe-style toolbar (Meal Plan · Groceries · Pin · Share)? Toolbar is a shared component — needs Meal Planning + Architect agreement. | open | |
| Q-02 | `defaultUnit` is a coarse per-aisle heuristic (produce→count, meat_seafood→pound, herbs_spices→teaspoon…). Good enough as an overridable prefill, or curate per-ingredient in the committed JSON? | open | |
| Q-03 | Bakery / frozen / household aisles have ~no USDA Foundation Foods, so the picker won't suggest bread/frozen items. Ship a small hand-added supplement list in `grocery-catalog.json`? (I lean yes.) | open | |
| Q-04 | Icons: up-front ~100-icon batch (~$4 Flash 1K, recommended) or on-demand+cache? And Flash vs. Pro tier — Flash 1K is my default for 40px icons. | open | |

---

# Appendix A — Changelog
| Date | Author | Change |
|---|---|---|
| 2026-08-07 | Grocery Lead | Initial draft (DESIGN gate) |
| 2026-08-07 | Grocery Lead | Add ingredient-icon expansion scope (~100 nano-banana icons), decision, Q-04, lockstep test |
