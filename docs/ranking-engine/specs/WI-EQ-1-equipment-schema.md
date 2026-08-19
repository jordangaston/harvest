# WI-EQ-1 — Equipment schema, model & preference fold-in

## Background

The kitchen-equipment signal (#9) is the ranking engine's **third hard filter**, alongside
allergens and diet (`docs/ranking-engine/DESIGN.md` § Ranking Algorithm;
`docs/ranking-engine/EQUIPMENT-SIGNAL.md`). Before any detection or filtering can be built, the
persistence layer and the user-preference model must carry equipment. This is the foundational,
additive-only schema story — no behaviour change yet, exactly the layering used by WI-RANK-1 for
the ranking preferences and by WI-DS-1 for the diet tables.

The design specifies (EQUIPMENT-SIGNAL.md §§ Tables, Entities, Modules):
- a controlled vocab tuple `EQUIPMENT_TYPES` in `schema.ts` (like `MAJOR_ALLERGENS`);
- two join tables — `recipe_equipment` (the rolled-up set the filter reads, carrying per-recipe
  `essentiality`) and `user_equipment` (what the user owns, mirroring `user_allergens`);
- two recipe columns — `recipe_steps.equipment` (JSON `Equipment[]`, like `techniques`) and
  `recipes.equipment_complete` (boolean, like `allergens_complete`);
- one `user_preferences.equipment_reviewed` boolean that gates the filter;
- the `UserPreferences` domain model + `PreferenceRepository` gaining `ownedEquipment: Equipment[]`
  and `equipmentReviewed: boolean`.

This story delivers the schema, its generated migration, the `EquipmentType` config module with the
`EQUIPMENT` table (aliases + `defaultEssentiality`), and the preference fold-in. No workflow step and
no filter yet — those are WI-EQ-2 and WI-EQ-3.

**Conventions (server/CLAUDE.md):** Drizzle migrations only (`db:generate` → `db:migrate`, never DDL
by hand); enum tuples are `text { enum }`; booleans are `integer { mode: 'boolean' }`; JSON arrays are
`text { mode: 'json' }`; the domain model is a Zod schema that the repository `parse`s at the boundary;
classes with a `static create()`.

## Objective

Add the equipment persistence layer (two tables, two recipe columns, one preference column, the
`EQUIPMENT_TYPES` vocab), the `EQUIPMENT` config module (`server/src/equipment/equipment.ts`), and fold
`ownedEquipment` + `equipmentReviewed` into `UserPreferencesSchema` and `PreferenceRepository`, with a
generated Drizzle migration. Additive only — every existing test still passes and existing recipes read
as `equipment_complete = false`, `equipment_reviewed = false` (signal inert).

## Acceptance Criteria

1. **Vocab tuple.** Given `server/src/schema.ts`, when it is imported, then it exports
   `EQUIPMENT_TYPES` as an `as const` tuple exactly:
   `['air_fryer','slow_cooker','pressure_cooker','stand_mixer','blender','food_processor','grill','dutch_oven','deep_fryer','wok','sous_vide','smoker','ice_cream_maker','waffle_iron']`
   and an `ESSENTIALITY = ['required','recommended'] as const` tuple, plus an exported
   `Equipment = (typeof EQUIPMENT_TYPES)[number]` type.

2. **`recipe_equipment` table.** Given the schema, when migrated, then `recipe_equipment` exists with
   columns `recipe_id` (text, FK → `recipes.id` cascade), `equipment` (text enum `EQUIPMENT_TYPES`,
   not null), `essentiality` (text enum `ESSENTIALITY`, not null); primary key `(recipe_id, equipment)`;
   an index on `(equipment)`.

3. **`user_equipment` table.** Given the schema, when migrated, then `user_equipment` exists with
   `user_id` (text, FK → `users.id` cascade), `equipment` (text enum `EQUIPMENT_TYPES`, not null);
   primary key `(user_id, equipment)`.

4. **Recipe columns.** Given the schema, when migrated, then `recipe_steps` has a nullable
   `equipment` JSON column (`Equipment[]`) and `recipes` has `equipment_complete`
   (`integer { mode: 'boolean' }`, not null, default false).

5. **Preference column.** Given the schema, when migrated, then `user_preferences` has
   `equipment_reviewed` (`integer { mode: 'boolean' }`, not null, default false).

6. **Migration generated, not hand-written.** Given `npm run db:generate`, when run against the new
   schema, then a new `drizzle/00NN_*.sql` file is produced containing the two `CREATE TABLE`s, the two
   `ALTER TABLE ADD COLUMN`s, and the index; and `npm test` (which migrates a `file:` libSQL db from the
   generated DDL) passes.

7. **`EQUIPMENT` config module.** Given `server/src/equipment/equipment.ts`, when imported, then it
   exports the `EQUIPMENT: EquipmentType[]` table (canonical + `defaultEssentiality` + `aliases`)
   covering all 14 vocab values exactly as in EQUIPMENT-SIGNAL.md § Detection, with `sous_vide`,
   `smoker`, `ice_cream_maker`, `waffle_iron` defaulting to `required` and the rest to `recommended`;
   plus a `defaultEssentiality(equipment)` lookup helper. Every `canonical` is a member of
   `EQUIPMENT_TYPES` (a compile-time `satisfies`/typed check, mirroring `technique-difficulty.ts`).

8. **Model fold-in.** Given `UserPreferencesSchema`, when it parses a preferences object, then it
   requires `ownedEquipment: Equipment[]` and `equipmentReviewed: boolean`; `UserPreferences` type
   includes both.

9. **Repository fold-in.** Given `PreferenceRepository.getPreferences(userId)`, when the user has
   `user_equipment` rows and `equipment_reviewed = true`, then the returned `UserPreferences` has
   `ownedEquipment` = the owned set and `equipmentReviewed = true`; when the user has no preferences row
   (cold start), then `ownedEquipment = []` and `equipmentReviewed = false`.

10. **Backwards-compatible.** Given the full existing suite, when `npm test` and `npm run typecheck`
    run, then both are green with no changes to unrelated tests.

## Test Cases

### Test Case 1: Schema migrates and round-trips (extends test/preference-repository.test.ts style)

**Preconditions:** A migrated `file:` libSQL db via `migratedFileDb()`; a seeded user.

**Steps:**
1. Insert a `recipe` (owned) and a `recipe_steps` row with `equipment: ['air_fryer']`.
2. Insert `recipe_equipment` rows `{recipeId, equipment:'air_fryer', essentiality:'recommended'}` and
   `{recipeId, equipment:'sous_vide', essentiality:'required'}`.
3. Insert `user_equipment` `{userId, equipment:'slow_cooker'}` and set the user's
   `user_preferences.equipment_reviewed = true`.
4. Select each back.

**Expected Outcomes:** All rows persist; the `recipe_steps.equipment` JSON reads back as
`['air_fryer']`; the `recipe_equipment` composite PK rejects a duplicate `(recipeId,'air_fryer')`;
deleting the user cascades `user_equipment`; deleting the recipe cascades `recipe_equipment`.

### Test Case 2: EQUIPMENT config covers the vocab with the design's priors

**Preconditions:** none (pure import).

**Steps:** Import `EQUIPMENT` and `EQUIPMENT_TYPES`.

**Expected Outcomes:** `EQUIPMENT.map(e => e.canonical)` is a permutation of `EQUIPMENT_TYPES` (every
vocab value has exactly one config entry); `defaultEssentiality('sous_vide') === 'required'`,
`defaultEssentiality('air_fryer') === 'recommended'`; each entry's `aliases` is non-empty and lowercase.

### Test Case 3: PreferenceRepository folds in equipment (extends preference-repository.test.ts)

**Preconditions:** migrated db; a user with a `user_preferences` row, `equipment_reviewed = true`, and
`user_equipment` = {`slow_cooker`, `blender`}.

**Steps:** Call `PreferenceRepository.create(db).getPreferences(userId)`.

**Expected Outcomes:** `prefs.ownedEquipment` sorted = `['blender','slow_cooker']`;
`prefs.equipmentReviewed === true`. For a cold-start user (no prefs row):
`prefs.ownedEquipment === []`, `prefs.equipmentReviewed === false`.

## Test Run

_To be filled during execution: `npm test` + `npm run typecheck` output._

## Deployment Strategy

Additive schema migration, deployed ahead of any code that reads the columns (EQUIPMENT-SIGNAL.md §
Deployment order 1). Backwards-compatible: existing recipes default `equipment_complete = false` and
users default `equipment_reviewed = false`, so the not-yet-built filter stays inert. `drizzle-kit
migrate` applies the new file in journal order. No flag needed — nothing consumes the data yet.

## Production Verification

### Production Verification 1: Migration applied, columns present

**Preconditions:** migration deployed to the Turso target.

**Steps:** Inspect the schema for `recipe_equipment`, `user_equipment`, `recipes.equipment_complete`,
`recipe_steps.equipment`, `user_preferences.equipment_reviewed`.

**Expected Outcomes:** All present; existing rows show `equipment_complete = 0`,
`equipment_reviewed = 0`; no existing query breaks.

## Production Verification Run

_To be filled during execution._
