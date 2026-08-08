# Grocery Lists — Sprint Report

Wave-2 Feature: a per-user grocery list — add ingredients manually (Todoist-style) or from a recipe (scaled by
servings), view them grouped by aisle, sorted by aisle / recipe / A–Z, and check them off while shopping. Built to
`DESIGN.md` + `WAVE2-DECISIONS.md`.

## What shipped

### Data model (migration `0009_grocery_items`)
- `grocery_aisle` pg enum (store-walk order) + `grocery_items` table (`user_id, name, amount, unit,
  quantity_text, aisle, icon, checked, source_recipe_id, position, created_at`), one flat per-user list.
- `source_recipe_id` is `ON DELETE SET NULL` (a deleted recipe keeps its already-bought items); `user_id` cascades.

### Catalog (owned; the shared contract)
- `server/seed/grocery-catalog.json` — **160 entries** built offline from USDA Foundation Foods
  (`scripts/build-grocery-catalog.ts`; raw source not committed). Each entry `{canonicalName, aisle, defaultUnit,
  iconKey}`. Category→aisle + per-aisle default unit live in `server/src/grocery/aisle-map.ts`, plus a small hand
  supplement for bakery/drinks/frozen (closes the USDA gap).

### Server domain + API
- `GroceryCatalog` (resolve-by-icon-taxonomy + common), `GroceryItem` Zod model, `GroceryRepository`,
  `GroceryService` — the single **add chokepoint** (resolve aisle/icon + default unit, then merge by name+unit or
  insert). Classes with `static create()`, Zod-at-boundary, migrations-only.
- Endpoints: `GET/POST/PATCH/DELETE /v1/grocery_items` + **`GET /v1/ingredients/common`** (the
  `[{canonicalName,aisle,defaultUnit,iconKey}]` contract Meal Planning consumes).

### Icons
- **153** painterly ingredient icons (55 prior + ~98 new via the nano-banana-2 MCP), wired into
  `server/src/parse/icons.ts` **and** the app `ICON` map. Real-icon catalog coverage 59 → **114 / 160**.
- **Architect must-fix shipped:** `tests/unit/icon-lockstep.test.ts` fails the build if the keyword map, the ICON
  map, and the asset files ever drift.

### Mobile
- `app/(app)/groceries.tsx` — grouped/sorted list, check-off (strike + sink), long-press delete, sort sheet,
  add FAB, order-online stub. TanStack Query (`useGroceries`) + invalidate-on-mutation per `docs/client-caching.md`.
- `AddGrocerySheet` — Todoist parse with a **live quantity/unit/keyword highlight** (founder request) + a
  common-ingredients picker.
- `AddToGroceriesSheet` (recipe `⋯` → "Add to groceries") — servings stepper scales amounts, checklist, "Add N
  items" → a tappable "tap to view groceries" toast (motion tokens + Reduce Motion).
- `lib/grocery/{parse,scale,sort}.ts`, `lib/api/groceries.ts`, hooks + `queryKeys`.

## Tests
- **Whole server suite green offline: 26 files, 102 tests** — incl. 7 grocery unit (catalog resolve, merge,
  default-unit, freeform) + 7 grocery integration (real Fastify + Postgres: add, merge, recipe-batch, check/edit/
  delete, ownership 404s, empty/unauth, common contract) + 2 icon-lockstep.
- **Mobile `tsc --noEmit`: clean.**
- Tests never hit the network; test DB isolated per the brief (see POSTMORTEM), config reverted to default 5432.

## Cross-task interfaces
- **Own / expose:** `grocery-catalog.json`, `grocery_aisle` enum, `grocery_items`, `GET /v1/ingredients/common`,
  the recipe-screen "Add to groceries" entry point.
- **Consume:** Cleanup's structured `recipe.ingredients` + `servings` (already on the recipe screen); the shared
  icon map. Did **not** need Meal Planning's `GET /v1/recipes`.
- **Migration note:** adds `grocery_aisle` + `grocery_items` as `0009`; number will collide across branches — the
  coordinator reconciles at integration (self-contained migration).

## Demo
See `demos/DEMOS.md` — backend sub-stories demoed via tests against the real app+DB (reproduce command included);
UI walkthrough code-mapped. A live sim capture was skipped by decide-and-log to avoid destabilizing the shared
machine (disk/PG/sim were degraded; details in POSTMORTEM).

## Follow-ups
- Restore a canonical Postgres on 5432 (coordinator; shared-infra, escalated).
- Optional: hand-curate the messy tail of USDA `canonicalName`s in the committed catalog; per-ingredient default
  units (currently per-aisle); the remaining catalog entries still on the Harvest-H fallback icon.
- No mobile unit-test runner exists — the pure grocery utils are covered by `tsc` + demo; consider adding one.
