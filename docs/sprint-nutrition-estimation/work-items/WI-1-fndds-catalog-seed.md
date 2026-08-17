# WI-1 — FNDDS catalog schema + seed

## Background

Imported recipes often arrive without nutrition. The nutrition-estimation feature (DESIGN.md)
estimates the eight label-core macros and a health score from ingredient lines, matched against
USDA's FNDDS (Survey) food dataset seeded offline. This work item lays the foundation: the two-table
catalog, its FTS5 search mirror, the shared `normalize()` function, the nutrient-code map, and the
offline seed script. WI-2 (matching + conversion) and WI-3 (estimator + API) build on it, so this
ships first and stands alone.

The design stores the **full 65-nutrient panel** per food, not just the eight scored macros, so
later features read seeded data with no re-seed (DESIGN "One complete source (FNDDS), stored at full
nutrient granularity"). The 66MB source JSON is never committed; tests run against a small
hand-written fixture.

Grounding in the existing repo:
- Schema: `server/src/schema.ts` (`sqliteTable`, numeric→text convention).
- Migrations: generated into `server/drizzle/` via `npm run db:generate`, applied via
  `npm run db:migrate` (`server/drizzle.config.ts`, dialect `turso`). `server/drizzle/0000_init.sql`
  is the only existing migration; there is **no FTS5 / virtual-table / raw-SQL migration yet**.
- Seed-script style: `server/scripts/build-grocery-catalog.ts` (reads a USDA JSON from
  `homedir`/env, transforms, writes committed output; run via `tsx`).
- Label core: `server/src/models/label-core.ts` (`LABEL_CORE_KEYS`, the eight macros).
- Test DB helper: `server/test/helpers/migrated-db.ts` → `migratedFileDb()` (throwaway `file:`
  libSQL, runs all `drizzle/` migrations). Vitest (`server/vitest.config.ts`).

## Objective

Ship the seeded FNDDS catalog: two Drizzle tables (`fdc_foods`, `fdc_food_nutrient`), a hand-written
FTS5 mirror migration over `fdc_foods.description_normalized`, a pure shared `normalize()` function,
an `FDC_NUTRIENT` code map extending `label-core.ts`, an offline seed script
`server/scripts/build-fdc-catalog.ts`, and a committed ~12-food test fixture. All migrations apply
cleanly on `migratedFileDb()`; the fixture seeds and is queryable, including an FTS5 match on a
normalized name.

## Acceptance Criteria

- **AC-1** — `fdc_foods` table exists with columns: `fdc_id` (integer, primary key),
  `description` (text, not null), `description_normalized` (text, not null), `category` (text,
  nullable), `portions` (text JSON, nullable), plus a non-unique index on `description_normalized`
  (`fdc_foods_norm_idx`). Defined in `server/src/schema.ts`; migration generated into
  `server/drizzle/`.
- **AC-2** — `fdc_food_nutrient` table exists with columns: `fdc_id` (integer, not null, FK →
  `fdc_foods.fdc_id`), `nutrient_number` (text, not null), `amount_per_100g` (text, not null);
  composite primary key `(fdc_id, nutrient_number)`; an index covering `fdc_id` for the per-food
  read (the composite PK's leading column satisfies this — no separate index needed). Defined in
  `server/src/schema.ts`; migration generated.
- **AC-3** — A **hand-written** SQL migration file in `server/drizzle/` creates an FTS5 virtual
  table `fdc_foods_fts` over `fdc_foods.description_normalized` using `content='fdc_foods'` and the
  `trigram` tokenizer, plus INSERT/UPDATE/DELETE triggers keeping it in sync with `fdc_foods`. The
  file is registered in the drizzle journal (`server/drizzle/meta/_journal.json`) so
  `migratedFileDb()` applies it. `[ASSUMPTION: Turso/libSQL supports FTS5 + the trigram tokenizer at
  runtime. The implementer MUST verify this early by running the migration against migratedFileDb()
  before building on it. If unsupported, fall back to a `like`-over-`description_normalized` lookup
  (using the existing norm index), drop the FTS objects from this migration, and note the fallback
  in the Test Run.]`
- **AC-4** — A pure `normalize(name: string): string[]` function (its own module, e.g.
  `server/src/nutrition/normalize.ts`) lowercases, drops parenthetical segments, strips a
  prep/descriptor word list (e.g. `sifted`, `chopped`, `fresh`, `diced`, `minced`, `to taste`),
  singularizes plurals, and tokenizes to an array. It is exported for reuse by both the seed script
  and WI-2's matcher (the single chokepoint that keeps recipe and catalog keys consistent).
- **AC-5** — An `FDC_NUTRIENT` const map (extending `server/src/models/label-core.ts` or a sibling
  module it re-exports) maps a symbolic name to its FDC nutrient number for at least: the eight
  label-core macros (energy/calories `208`, protein `203`, total fat `204`, saturated fat `606`,
  carbohydrate `205`, fiber `291`, total sugars `269`, sodium `307`) and the NRF-relevant extras
  named in the design (vitamin D `328`, DHA `621`, EPA `629`). Each label-core key has a
  corresponding `FDC_NUTRIENT` number, and a helper maps an `FDC_NUTRIENT` number back to its
  `LabelCoreKey` for the eight macros. `[ASSUMPTION: nutrient numbers above are the standard USDA FDC
  numbers; the implementer verifies each against the fixture/source data — do not add a test that
  asserts USDA's numbering is correct (third-party).]`
- **AC-6** — `server/scripts/build-fdc-catalog.ts` (mirroring `build-grocery-catalog.ts`) reads the
  FNDDS Survey JSON (path from `FNDDS_JSON` env or a `homedir` default, top key `SurveyFoods`) and,
  per food, extracts `fdc_id`, `description`, `normalize(description)` joined to
  `description_normalized`, `category` (from `wweiaFoodCategory`), `portions`
  (`[{description, gramWeight}]` from `foodPortions`, description taken from `portionDescription`),
  and the full nutrient panel (`foodNutrients[]` → one `fdc_food_nutrient` row per nutrient, keyed
  by `nutrient.number`, value `amount`). It populates both tables idempotently
  (`INSERT … ON CONFLICT DO NOTHING`), so re-running is a no-op. The 66MB JSON is **not** committed.
- **AC-7** — A committed fixture `server/test/fixtures/fdc-foods.fixture.ts` exports ~12 hand-written
  foods with their nutrient panels, including at minimum: a produce food (e.g. spinach), a fish food
  carrying omega-3 (DHA/EPA) and vitamin D (e.g. salmon), and a fatty/salty food (e.g. potato
  chips). It exposes a helper `seedFdcFixture(db)` that inserts the fixture into `fdc_foods` +
  `fdc_food_nutrient` (reused by WI-2/WI-3 tests).
- **AC-8** — Running `seedFdcFixture(db)` on a `migratedFileDb()` yields queryable `fdc_foods` and
  `fdc_food_nutrient` rows, and an FTS5 `MATCH` query on the normalized form of a fixture food's
  name returns that food (or, under the AC-3 fallback, the `like` lookup returns it).
- **AC-9** — `npm run test` and `npm run typecheck` pass with the new schema, migrations, function,
  map, and fixture in place; no test hits the network.

## Test Cases

### Test Case 1: Migrations apply on a fresh throwaway DB (AC-1, AC-2, AC-3)

**Preconditions:** New `fdc_foods` / `fdc_food_nutrient` tables in `schema.ts`; generated migration
plus the hand-written FTS5 migration committed to `server/drizzle/` and journalled.

**Steps:**
1. Call `migratedFileDb()` from a new test (e.g. `server/test/fdc-catalog.test.ts`).
2. Query `sqlite_master` for table/index names.

**Expected Outcomes:** No migration error. `sqlite_master` contains `fdc_foods`, `fdc_food_nutrient`,
`fdc_foods_norm_idx`, and (unless the AC-3 fallback is active) `fdc_foods_fts` plus its three sync
triggers. The `fdc_food_nutrient` composite PK `(fdc_id, nutrient_number)` is present.

### Test Case 2: `normalize()` drop-case and keep-case per rule (AC-4)

**Preconditions:** `normalize()` exported.

**Steps:**
1. Assert `normalize("all-purpose flour, sifted")` shares tokens (e.g. `flour`) with
   `normalize("Flour, wheat, all-purpose, unenriched")` — the descriptor `sifted` is dropped.
2. Assert one drop-case per rule: parenthetical dropped (`normalize("butter (unsalted)")` omits
   `unsalted`); prep word dropped (`chopped onion` → no `chopped`); plural singularized
   (`eggs` → token `egg`).
3. Assert one keep-case: a descriptor-looking word inside a legitimate food name is not stripped to
   emptiness (e.g. `normalize("fresh cheese")` still yields `cheese`; `normalize("to taste")`-style
   input never returns an empty token array for a real food name).

**Expected Outcomes:** Each assertion holds. Tokens are lowercase; no parentheticals; listed
prep/descriptor words absent; plurals singular; no rule empties a genuine food name.

### Test Case 3: `FDC_NUTRIENT` maps the eight macros (AC-5)

**Preconditions:** `FDC_NUTRIENT` map and the number→`LabelCoreKey` helper exported.

**Steps:**
1. Assert each of the eight `LABEL_CORE_KEYS` resolves to a nutrient number via `FDC_NUTRIENT`.
2. Assert the reverse helper maps `208`→`calories`, `203`→`grams_of_protein`,
   `307`→`milligrams_of_sodium` (representative of the eight).
3. Assert `FDC_NUTRIENT` also defines vitamin D (`328`), DHA (`621`), EPA (`629`).

**Expected Outcomes:** All eight macros map both directions; the three NRF extras are present. (Do
not assert USDA numbering correctness — third-party.)

### Test Case 4: Fixture seeds and is queryable, FTS5 match works (AC-7, AC-8)

**Preconditions:** `fdc-foods.fixture.ts` + `seedFdcFixture(db)` exist; migrated DB.

**Steps:**
1. `const { db } = await migratedFileDb(); await seedFdcFixture(db);`
2. Assert `fdc_foods` row count equals the fixture length and `fdc_food_nutrient` count equals the
   sum of the fixtures' panel sizes.
3. Assert the salmon fixture food has `fdc_food_nutrient` rows for DHA (`621`) and vitamin D (`328`).
4. Run an FTS5 `MATCH` for the normalized token of "salmon" (or the AC-3 fallback `like`) and assert
   it returns the salmon `fdc_id`.

**Expected Outcomes:** Counts match the fixture; salmon carries omega-3 + vitamin D rows; the
search returns the salmon food.

### Test Case 5: Seed script is idempotent (AC-6)

**Preconditions:** `build-fdc-catalog.ts` exposes its insert logic against an injectable `db` and a
small in-memory foods array (or the fixture) so it runs offline without the 66MB JSON.

**Steps:**
1. Run the seed insert against a migrated DB twice with the same input foods.
2. Count `fdc_foods` and `fdc_food_nutrient` rows after each run.

**Expected Outcomes:** Row counts are identical after the second run (`ON CONFLICT DO NOTHING`); no
error. `[ASSUMPTION: the script's insert path is factored so a test can call it with a db + foods
array; if it only runs as a CLI main, the test exercises the extracted insert function.]`

### Test Case 6: Suite and typecheck green (AC-9)

**Preconditions:** All above in place.

**Steps:** Run `npm run test` and `npm run typecheck` in `server/`.

**Expected Outcomes:** Both pass; no network access.

## Test Run

To be filled during execution.

## Deployment Strategy

All changes are **additive and backwards-compatible**:
- Migration 1 (generated): create `fdc_foods` + `fdc_food_nutrient` — new tables, nothing else
  reads them yet.
- Migration 2 (hand-written SQL): the FTS5 mirror + triggers over the new table.
- Data seed (offline, run once): `tsx server/scripts/build-fdc-catalog.ts` against the target
  database, pointed at the FNDDS Survey JSON via `FNDDS_JSON`. Idempotent
  (`INSERT … ON CONFLICT DO NOTHING`), so re-runs are safe.

Migrations ship before the seed. Single service; no code yet reads the catalog (WI-2/WI-3 do), so
these tables are inert on deploy. **Rollback:** the new tables are unread by existing code; redeploy
the prior build and drop them later if needed. No data migration to reverse.

Codegen stays non-interactive in CI: each generated migration only adds tables (no drop+add on one
table). The FTS5 file is committed by hand, not generated.

## Production Verification

### Production Verification 1: Catalog present and searchable in the target DB

**Preconditions:** Migrations applied and the seed run against the production/staging Turso database.

**Steps:**
1. Query `SELECT count(*) FROM fdc_foods;` and `SELECT count(*) FROM fdc_food_nutrient;`.
2. Run an FTS5 `MATCH` (or fallback `like`) for a common normalized food token (e.g. `salmon`).
3. For the returned `fdc_id`, query its `fdc_food_nutrient` rows for `208` (energy) and `328`
   (vitamin D).

**Expected Outcomes:** `fdc_foods` ≈ 5,432 rows; `fdc_food_nutrient` in the hundreds of thousands;
the search returns a salmon food carrying energy and vitamin D. `[ASSUMPTION: exact counts depend on
the FNDDS release; assert non-zero and roughly the documented magnitude, not an exact number —
third-party data.]`

## Production Verification Run

To be filled during execution.
