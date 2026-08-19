# WI-EQ-3 — EquipmentFilter + soft penalty in the RankingEngine

## Background

With equipment detected and persisted (WI-EQ-2) and owned-equipment on the user (WI-EQ-1), this story
adds half (B) of the design — **the filter in ranking** (EQUIPMENT-SIGNAL.md § Ranking integration). It
is a **hard filter + soft penalty**, exactly mirroring allergen severity and diet strictness, and
carries **no per-user weight** — like the other two hard filters (`filters.ts`:
`AllergenFilter`/`DietFilter`; `ranking-engine.ts` § penalty).

**Hard filter — `EquipmentFilter`** (new `FilterRule` in the engine's registry):
```
excludes(recipe, prefs):
  if not prefs.equipmentReviewed:  return false   # kitchen unknown → never hide anything
  if not recipe.equipmentComplete: return false   # detection unknown/failed → lenient
  for { equipment, essentiality } in recipe.equipment:
    if essentiality == 'required' and equipment ∉ prefs.ownedEquipment:
      return true                                  # exclude — non-substitutable & absent
  return false
```

**Soft penalty:** a flat **−0.10** (a new `PENALTY_MISSING_EQUIPMENT` constant) if
`prefs.equipmentReviewed` and the recipe has any `recommended` equipment the user doesn't own. Flat, not
per-item (avoid burying a recipe that merely suggests two gadgets), applied after the weighted average
and floored at 0 — joining the existing `penalty()` accumulation in `RankingEngine`.

**Gating & leniency:** the filter and penalty engage only when `equipment_reviewed` is true (same
"no data → no filter" stance as allergens); a recipe with `equipment_complete = false` is treated as
unknown and never excluded (tiered-fallback leniency).

The filter reads **per-recipe essentiality** off `recipe_equipment` — so `RankableRecipe` must gain an
`equipment: { equipment: Equipment; essentiality: Essentiality }[]` field and an `equipmentComplete:
boolean`, populated by `RecipeRepository.assembleRankable` in one batched query (like `dietFitByRecipe`),
and `UserPreferences` already carries `ownedEquipment` + `equipmentReviewed` from WI-EQ-1.

## Objective

Add `EquipmentFilter` to the engine's `FilterRule[]` registry and a flat missing-equipment soft penalty
to `RankingEngine.penalty`, extend `RankableRecipe` with the per-recipe equipment set + completeness,
and populate it in `RecipeRepository.assembleRankable` via a batched `recipe_equipment` read. The worked
example (EQUIPMENT-SIGNAL.md § Worked example) passes end to end; `npm test` + `npm run typecheck` green.

## Acceptance Criteria

1. **RankableRecipe carries equipment.** Given `ranking/types.ts`, when compiled, then `RankableRecipe`
   has `equipment: { equipment: Equipment; essentiality: 'required' | 'recommended' }[]` and
   `equipmentComplete: boolean`.

2. **EquipmentFilter — gating.** Given `prefs.equipmentReviewed === false`, when
   `EquipmentFilter.excludes(recipe, prefs)` runs for any recipe, then it returns `false` (never hides).

3. **EquipmentFilter — leniency.** Given `equipmentReviewed === true` but
   `recipe.equipmentComplete === false`, when `excludes` runs, then it returns `false`.

4. **EquipmentFilter — required-missing excludes.** Given `equipmentReviewed === true`,
   `equipmentComplete === true`, and the recipe has a `required` item not in `prefs.ownedEquipment`, when
   `excludes` runs, then it returns `true`.

5. **EquipmentFilter — owned / recommended-missing keeps.** Given the same gating, when the only
   unowned items are `recommended` (or every `required` item is owned), then `excludes` returns `false`
   (a recommended-missing item is handled by the soft penalty, not the filter).

6. **Soft penalty.** Given `equipmentReviewed === true` and the recipe has ≥1 `recommended` item the
   user doesn't own, when the engine scores it, then a flat `PENALTY_MISSING_EQUIPMENT` (0.10) is
   subtracted **once** (not per item), after the weighted average, floored at 0. No penalty when
   `equipmentReviewed === false`, or when all `recommended` items are owned, or when the recipe has only
   `required` items (those are the filter's job).

7. **Registered in the engine.** Given `RankingEngine.create()`, when constructed, then
   `EquipmentFilter` is in the `filters` array (alongside `AllergenFilter`, `DietFilter`); no other
   engine change (one array entry + one penalty branch, per the design "one array entry, no engine
   change").

8. **Repository populates the field.** Given `RecipeRepository.listRankable` / `listDeckCandidates` /
   `getRankable`, when they assemble recipes, then each `RankableRecipe.equipment` is loaded from
   `recipe_equipment` in ONE batched query keyed by recipe id (no N+1, like `dietFitByRecipe`), and
   `equipmentComplete` reads `recipes.equipment_complete`.

9. **Worked example (end-to-end deck).** Given a reviewed user owning `{slow_cooker, blender}` and the
   five design recipes (A sous-vide required, B air-fryer recommended, C slow-cooker owned, D none,
   E smoker with `equipment_complete = false`), when ranked, then A is excluded; B kept but penalized
   −0.10 vs an otherwise-equal recipe; C, D, E kept unpenalized; and with `equipmentReviewed = false`
   all five are kept and unpenalized.

10. **Green.** `npm test` + `npm run typecheck` pass, including the new filter/penalty unit tests and
    the repository population test.

## Test Cases

### Test Case 1: EquipmentFilter matrix (unit — extends ranking-engine.test.ts)

**Preconditions:** a `rankableRecipe` factory extended with `equipment` + `equipmentComplete`
defaults; a `preferences` factory extended with `ownedEquipment` + `equipmentReviewed`.

**Steps:** Evaluate `EquipmentFilter.excludes` across: reviewed=false; reviewed=true+incomplete;
reviewed=true+complete+required-missing; reviewed=true+complete+required-owned;
reviewed=true+complete+recommended-missing.

**Expected Outcomes:** `false, false, true, false, false` respectively.

### Test Case 2: Missing-equipment soft penalty (unit — extends ranking-engine.test.ts)

**Preconditions:** engine `RankingEngine.create()`; a recipe scoring a known average with one
`recommended` unowned item; reviewed user owning nothing relevant.

**Steps:** Rank the recipe; compare to the same recipe with the item owned (no penalty) and to
`equipmentReviewed = false`.

**Expected Outcomes:** penalized case = average − 0.10; owned case = average; unreviewed case = average;
two `recommended` unowned items still subtract only 0.10 once; floors at 0 when average < 0.10.

### Test Case 3: assembleRankable populates equipment (integration — extends ranked-recipes.test.ts)

**Preconditions:** migrated db; a recipe with `recipe_equipment` rows + `equipment_complete = true`.

**Steps:** `RecipeRepository.listRankable(userId)`; inspect the returned `RankableRecipe.equipment` and
`equipmentComplete`.

**Expected Outcomes:** `equipment` matches the stored `(equipment, essentiality)` rows;
`equipmentComplete === true`; a recipe with no rows → `equipment: []`, `equipmentComplete` reads its
column.

### Test Case 4: Worked-example regression (unit)

**Preconditions:** the five design recipes + the reviewed user owning `{slow_cooker, blender}`.

**Steps:** `RankingEngine.create().rank([A,B,C,D,E], reviewedPrefs)`, then again with
`equipmentReviewed = false`.

**Expected Outcomes:** reviewed → A excluded; order/scores show B penalized 0.10 below its
un-penalized self; C, D, E unpenalized. Unreviewed → all five present, none penalized.

## Test Run

_To be filled during execution._

## Deployment Strategy

Code deploy after WI-EQ-2 (EQUIPMENT-SIGNAL.md § Deployment order 2). Inert until a user sets
`equipment_reviewed = true` (Q-E1: where they declare owned gear is product/UX, out of scope), and
lenient on recipes not yet detected — so it is safe to ship before the backfill. Start lenient and watch
`equipment_filtered_ratio` (design Monitoring) before trusting the hard exclude (Q-E6). No flag.

## Production Verification

### Production Verification 1: A reviewed user's deck respects equipment

**Preconditions:** deployed; a user with `equipment_reviewed = true` owning a known set; a detected
recipe requiring gear they lack.

**Steps:** Fetch the user's ranked deck.

**Expected Outcomes:** the required-missing recipe is absent; a recommended-missing recipe appears
ranked slightly lower; `equipment_filtered_ratio` stays within a sane band (no over-filtering spike).

## Production Verification Run

_To be filled during execution._
