# WI-2 — Nutrient catalog, vocab, and the directive fact type

## Background

WI-1 gave `user_food_prefs` the directive shape (`dimension` includes `nutrient`; `direction`,
`strength`, `scope`, `unit`). The chef still writes it through the old `FOOD_PREFERENCE` fact, whose
value is `{facet, value, sentiment, target}` and which cannot express `scope`/`strength`/`unit` or a
`nutrient` dimension. The design (§ Fact types) needs a grounding catalog for `nutrient`, the new
`vegetable`/`fruit` food categories, and a composite write path.

Depends on: WI-1 (the columns exist).

## Objective

Let the chef ground and persist a full directive — any dimension including `nutrient`, with
`scope`/`direction`/`strength`/`target`/`unit`.

## Scope

1. **Vocab** (`server/src/categorize/vocab.ts` + `FOOD_CLASSES` in
   `server/src/diet/food-class-map.ts`): `FOOD_CLASSES` already carries `vegetable` and `fruit`, so
   the `food_category` catalog already grounds them. Add `fruit` to the categorizer
   `primaryIngredient` VOCAB (it has `vegetable`, not `fruit`) only if WI-4 plate completion needs
   the recipe tag — otherwise skip (YAGNI; confirm against the plate spec).
2. **Nutrient catalog**: a `nutrient` grounding source (legal nutrients + phrase→canonical, e.g.
   "saturated fat" → the canonical nutrient), backed by the USDA nutrient reference already seeded
   in `fdc_food_nutrient` / the nutrient-number reference. Expose it as a `codeCandidates('nutrient')`
   catalog kind, mirroring `food_category`/`diet`/`allergen`.
3. **Directive fact type** (design § Fact types, recommended option): a `set_directive` tool /
   `FactType` that grounds `value` via the dimension's catalog, then persists the full directive
   (`dimension`, `value`, `scope`, `direction`, `strength`, `target?`, `unit?`) through
   `PreferenceRepository.upsertFoodPref`. `scope`/`strength`/`direction` are fixed-enum validation
   (no catalog). Widen `upsertFoodPref` (WI-1 kept it directive-shaped) to accept the new fields if
   not already.
4. Retire or fold in the old `FOOD_PREFERENCE` fact once `set_directive` covers its cases, updating
   the chef fact registry (`server/src/chef/facts/registry.ts`) and its description.

## Acceptance Criteria

- **AC-1** The `nutrient` catalog grounds "saturated fat", "sodium", "added sugar" to canonical
  nutrients and rejects a non-nutrient with `closest` suggestions.
- **AC-2** `set_directive` persists `{dimension:'nutrient', value:'saturated_fat', scope:'day',
  direction:'less', strength:'firm', target:20, unit:'grams'}` as one directive row.
- **AC-3** `set_directive` persists a recipe-scope taste directive
  (`{dimension:'cuisine', value:'thai', direction:'more', strength:'soft'}`) equivalently to the old
  `FOOD_PREFERENCE` like.
- **AC-4** `food_category` grounding accepts `vegetable` and `fruit`.
- **AC-5** An invalid `scope`/`strength`/`direction` rejects with an instructive reason.
- **AC-6** Build clean; suite green except the two media failures.

## Test Cases

### Test Case 1: nutrient grounding (AC-1)
**Preconditions:** the fact registry over a migrated, nutrient-seeded DB.
**Steps:** validate/normalize "saturated fat", then "unicorn dust".
**Expected:** the first grounds to the canonical nutrient id; the second rejects with `closest`.

### Test Case 2: composite directive persist (AC-2/3)
**Preconditions:** a member subject.
**Steps:** `writeFact(set_directive, member, {dimension:'nutrient', value:'saturated fat',
scope:'day', direction:'less', strength:'firm', target:20, unit:'grams'})`; read directives.
**Expected:** one directive with every field set; a second recipe-scope cuisine/more directive
round-trips too.

### Test Case 3: enum validation (AC-5)
**Steps:** `set_directive` with `scope:'fortnight'`.
**Expected:** rejected, reason names the legal scopes.

## Deployment Strategy

No schema change (WI-1 shipped the columns). Nutrient reference is seed data; ship the catalog +
fact type together. Registry change is code-only.

## Production Verification

### Production Verification 1: "less saturated fat" grounds and persists
**Steps:** the chef receives "cut back on saturated fat"; it calls `set_directive`.
**Expected:** a `nutrient`/`saturated_fat`/`less` directive lands — the original dropped-guidance bug
is fixed.
