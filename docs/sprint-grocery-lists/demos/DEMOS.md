# Grocery Lists — demo evidence (per sub-story)

Two layers of evidence: (1) backend sub-stories are demoed by tests that drive the **real Fastify app against a
real Postgres** (offline — no network), and (2) UI sub-stories are a code-mapped walkthrough (a live sim capture
was deliberately skipped — see the note at the bottom).

## How to reproduce the backend demo
```
cd server
# (local isolation: point at a working PG; see POSTMORTEM for why 5433)
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/harvest_test_grocery \
DBOS_SYSTEM_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/harvest_dbos_grocery \
PG_ADMIN_URL=postgresql://postgres:postgres@localhost:5433/postgres \
npx vitest run tests/unit/grocery.test.ts tests/integration/grocery.test.ts tests/unit/icon-lockstep.test.ts
```
**Verified result:** `Test Files 3 passed (3)`, `Tests 16 passed (16)`. Whole server suite:
`Test Files 26 passed (26)`, `Tests 102 passed (102)`.

## Backend sub-stories

### F-G1 — Add an ingredient manually (resolve + default unit + merge)
- `grocery items API > adds a manual item, resolving aisle/icon/default unit` — POST `{name:"chicken breast",
  amount:2}` → 201 with `aisle: meat_seafood, icon: chicken, unit: pound, amount: 2` (default unit applied).
- `grocery items API > merges a re-added item by name + unit` — adding "milk 1 carton" then "Milk 2 carton"
  yields **one** row, `amount 3`.
- Unit-taxonomy resolution + fallbacks: `GroceryCatalog.resolve` unit tests — "2 boneless chicken thighs" →
  `chicken/meat_seafood`, "fresh strawberries" → `strawberry/produce`, unknown → `other/default`.

### F-G2 — Add a recipe's ingredients (batch + source tag + scaling inputs)
- `grocery items API > adds many items from a recipe with source_recipe_id` — POST 3 items tagged with a real
  recipe id → 201; all three carry `source_recipe_id` (powers the by-recipe sort).
- Serving-scale + display math (`scaleAmount`, `formatQuantity`) — the sheet scales amounts by the servings ratio
  (¼ rounding) and leaves null-amount rows as their `quantity_text`.

### F-G3 — View / check off / manage
- `grocery items API > checks off, edits, and deletes an item` — PATCH `checked:true` → item checked; DELETE →
  204; list empties.
- `grocery items API > 404s patching or deleting another user's item` — ownership enforced.
- `grocery items API > rejects an empty add and an unauthenticated read` — 400 + 401.
- Grouping/sort (`groupAndSort`) — aisle order, by-recipe with "Added manually" last, A–Z; checked items sink.

### Cross-task contract — `GET /v1/ingredients/common`
- `common ingredients API > serves the catalog contract, filterable by q` — returns
  `[{canonicalName, aisle, defaultUnit, iconKey}]`, filterable by `q`. This is what Meal Planning consumes.

### Architect must-fix — icon-map lockstep
- `icon map lockstep` (2 tests) — every `icons.ts` keyword target has an app `ICON` entry, and every `ICON`
  entry has a real asset file. Fails the build if the two maps drift.

## Icons
153 painterly ingredient icons ship in `assets/ingredients/` (55 prior + ~98 new via nano-banana), wired into
both `server/src/parse/icons.ts` and the app `ICON` map. The catalog rebuild lifted real-icon coverage from
59 → **114 of 160** catalog entries. (Style spot-checked: strawberry/apple/etc. match the existing oil-on-linen
golden-hour set.)

## UI sub-stories — walkthrough (code-mapped)
- **Groceries screen** (`app/(app)/groceries.tsx`): `useGroceries()` (TanStack Query, cached); aisle-grouped by
  default with a **Sort** sheet (Aisle / Recipe / A–Z); rows show painterly icon + name + quantity + checkbox;
  tap toggles `checked` (strike + dim + sink) via `usePatchGroceryItem` (invalidates `groceries`); long-press
  removes; FAB opens the add sheet; "Order online" is the Wave-3 stub. `bg-cream` sheet / `bg-card` rows, no
  `bg-white`.
- **Add sheet** (`components/recime/AddGrocerySheet.tsx`): as you type, `parseGroceryLine` peels quantity+unit and
  a **live "Reading:" preview highlights** the quantity (amber), unit (olive), and ingredient (ink) — the
  founder's ask; common ingredients from `/v1/ingredients/common` filter live; add-without-closing for rapid entry.
- **Add-from-recipe** (`components/recime/AddToGroceriesSheet.tsx` from the recipe `⋯` menu): servings stepper
  scales every amount live; checklist (all checked, Deselect all); "Add N items" → a **tappable toast** "Added N
  items to grocery list — tap to view groceries" (motion tokens + Reduce-Motion honored) that routes to the tab.

### Live sim capture
`grocery-lists-demo.mp4` (~89s) is a real end-to-end capture on the iOS simulator against the live backend,
covering every UI sub-story above (parse preview, common picker, default unit, merge, aisle grouping, check-off,
Aisle/A–Z/Recipe sort, and recipe `⋯` → Add to groceries with servings scaling + batch add). Four key frames
(`frame-1-parse-preview.png` … `frame-4-recipe-sort.png`) sit alongside it.

Capture was hard-won: the machine was under extreme load (load avg peaked ~758) and the shared Data volume filled
to 100%, which wiped every Harvest lead's sim device mid-run. I reclaimed ~40GB by deleting only unused default
Xcode simulators (no lead/project data touched), recreated a dedicated device, ran Metro on `:8093` + my backend on
`:3009` (leaving the contended `:3000` alone), and drove the full flow. The clip is uniformly speed-adjusted from a
~7.7-min raw capture; every frame is real app behavior.
