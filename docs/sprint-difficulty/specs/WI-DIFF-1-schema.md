# WI-DIFF-1 — Difficulty schema & migration

## Background

The recipe difficulty signal (`docs/design-recipe-difficulty-signal.md`) stores difficulty at two
levels: a per-step atom on each step, aggregated into a recipe-level score + band. This work item adds
the storage columns and their migration. It is the foundation — WI-DIFF-2/3/4 depend on it. No logic
ships here; only schema.

Current schema (`server/src/schema.ts`): `recipes` holds per-recipe scalars including `nrfScore`
(numeric→text, nullable) — the exact precedent for `difficulty_score`. `recipe_steps` holds
`(id, recipe_id, position, text)`.

## Objective

Add three nullable columns and one index via a single additive Drizzle migration:
- `recipe_steps.difficulty` — the atomic per-step signal (integer 1–5).
- `recipes.difficulty_score` — the continuous 0–100 rollup (numeric→text, like `nrf_score`).
- `recipes.difficulty_band` — enum(`beginner`,`intermediate`,`advanced`), the derived band.
- Index `recipes_difficulty_band_idx` on `(difficulty_band)` — the band filter for ranking.

## Acceptance Criteria

1. Given `server/src/schema.ts`, when I inspect `recipeSteps`, then it has
   `difficulty: integer('difficulty')` (nullable, no default).
2. Given `recipes`, when I inspect it, then it has `difficultyScore: text('difficulty_score')`
   (nullable) and `difficultyBand: text('difficulty_band', { enum: ['beginner','intermediate','advanced'] })`
   (nullable), and a `recipes_difficulty_band_idx` index on `difficultyBand`.
   `[ASSUMPTION: reuse the existing numeric→text convention for the score, matching nrfScore, rather than a REAL column.]`
2b. When I inspect the enum tuple, then `DIFFICULTY_BANDS` is declared as a `const` tuple alongside the
   other enum tuples and is exported for reuse by the domain model.
3. Given the schema change, when I run `drizzle-kit generate`, then exactly one new migration SQL file
   is produced, it contains only `ALTER TABLE ... ADD COLUMN` and `CREATE INDEX` statements (no drops,
   no table rebuilds beyond what SQLite requires for add-column), and generation does **not** prompt
   interactively (per the codegen-non-interactive principle in `docs/harvest-principles.md`).
4. Given the generated migration, when I run `drizzle-kit migrate` against the local libSQL test db,
   then it applies cleanly and existing rows have `null` in all three new columns.
5. Given the full test suite, when I run it after the migration, then all tests pass (existing reads
   ignore the new nullable columns).

## Test Cases

### Test Case 1: Columns exist and are nullable
**Preconditions:** Clean checkout of this branch; local libSQL test db available.
**Steps:**
1. Run the project's migration generate command (see `server/package.json` scripts / `server/CLAUDE.md`).
2. Run the migrate command against the test db.
3. Query `PRAGMA table_info(recipe_steps)` and `PRAGMA table_info(recipes)`.
**Expected Outcomes:** `recipe_steps.difficulty` present, type INTEGER, `notnull=0`. `recipes.difficulty_score`
present (TEXT, nullable). `recipes.difficulty_band` present (TEXT, nullable). No existing column changed.

### Test Case 2: Band index exists
**Preconditions:** Migration applied.
**Steps:** Query `PRAGMA index_list(recipes)`.
**Expected Outcomes:** `recipes_difficulty_band_idx` is listed over `difficulty_band`.

### Test Case 3: Generation is non-interactive and additive
**Preconditions:** Schema edited.
**Steps:** Run generate in a non-TTY (`CI=1` or piped). Inspect the emitted `.sql`.
**Expected Outcomes:** Command exits 0 with no prompt; the SQL only adds columns + creates the index.

### Test Case 4: Suite green
**Preconditions:** Migration applied.
**Steps:** Run the server test suite.
**Expected Outcomes:** All tests pass.

## Deployment Strategy

Direct deploy, migration-first. Additive and backwards-compatible: three nullable columns + one index,
no drops, no data migration. Old code ignores the columns; the migration runs before the writer code
(WI-DIFF-3) ships, in any order. Rollback: the columns are inert without a writer; drop them after a
code rollback only if necessary.

## Production Verification

### Production Verification 1: Schema live
**Preconditions:** Migration deployed to the Turso instance.
**Steps:** Inspect the live `recipes` / `recipe_steps` schema.
**Expected Outcomes:** The three columns and the band index exist; existing recipes read normally with
`null` difficulty.
