# WI-EQ-2 — equipmentStep: EquipmentDetector (LLM) + EquipmentMatcher fallback + persist

## Background

With the schema in place (WI-EQ-1), this story adds **detection at import** — half (A) of the design
(EQUIPMENT-SIGNAL.md § Detection). Equipment is often **implicit** ("Air Fryer Wings" whose steps only
say "cook at 400°F") and essentiality/substitutability is a **judgment**, so detection is
**LLM-primary** with a deterministic keyword **fallback**, mirroring the pipeline's tiered-fallback rule
(server/CLAUDE.md § Pipelines) — here inverted: LLM primary, keyword floor on failure.

The design mandates a **dedicated** `equipmentStep` (its own WDK `"use step"`) running its own
`EquipmentDetector` LLM call — NOT folded into the categorizer (resolved Q-E4). This mirrors the
existing per-step detector wiring: `RecipeAnalyzer`/`LunaRecipeAnalyzer`/`StubRecipeAnalyzer` selected
by `OPENAI_API_KEY` (`taste-classifier.ts`), constrained to a controlled vocab like the cuisine/technique
output, with an offline stub so tests never hit the network. The deterministic fallback mirrors
`TechniqueMatcher` (`difficulty/technique-matcher.ts`) — a `\b`-anchored, case-insensitive alias scan
over step text.

Pipeline shape becomes (EQUIPMENT-SIGNAL.md § The import step):
`fetch → resolve → nutrition → cost → allergen → categorize → equipment → diet → persist`
(equipment after categorize so the dish type is an available cue).

Per recipe the detector returns `equipment: { type, essentiality }[]` (recipe-level set, per-recipe
essentiality) plus `stepEquipment: Equipment[][]` (aligned to steps, like `stepTechniques`). On LLM
failure the matcher fills `equipment` from explicit mentions with each type's `defaultEssentiality` and
sets `equipment_complete = false`. Persist writes `recipe_steps.equipment` (per step), the
`recipe_equipment` roll-up `(recipe_id, equipment, essentiality)`, and `recipes.equipment_complete`.

Best-effort, exactly like `allergenStep`/`dietStep`: a per-recipe try/catch leaves a failed recipe
unenriched (`equipment_complete = false`), never failing an import.

## Objective

Build `EquipmentDetector` (LLM-primary, vocab-constrained, offline stub) and the pure `EquipmentMatcher`
(deterministic alias fallback), wire a dedicated best-effort `equipmentStep` into the import workflow
after `categorizeStep`, and persist `recipe_steps.equipment`, `recipe_equipment`, and
`recipes.equipment_complete` through `RecipeRepository` + `import-persist`. Offline-testable end to end;
`npm test` + `npm run typecheck` green.

## Acceptance Criteria

1. **EquipmentMatcher (pure fallback).** Given `EquipmentMatcher.create()` and a step list, when
   `detect(steps)` runs, then it returns, per step, the `Equipment[]` whose `EQUIPMENT` aliases match on
   `\b`-anchored, case-insensitive, diacritic/hyphen-folded boundaries (reusing the normalization
   approach of `TechniqueMatcher`), plus the recipe-level roll-up (the union) with each item's
   `defaultEssentiality`. "Air Fryer"/"air-fryer"/"airfryer" all match `air_fryer`; "airfryerless" does
   not false-match; empty/none → `[]`; per-step output is index-aligned to `steps`.

2. **EquipmentDetector (LLM primary).** Given `EquipmentDetector` with a live analyzer seam
   (`OPENAI_API_KEY`), when `detect(title, ingredients, steps)` runs, then it returns
   `{ equipment: {type,essentiality}[], stepEquipment: Equipment[][], complete: true }` where every
   `type` is a member of `EQUIPMENT_TYPES` (off-vocab dropped, like the cuisine/technique constraint),
   every `essentiality` ∈ `ESSENTIALITY` (invalid coerced to the type's `defaultEssentiality`), and
   `stepEquipment` is aligned to `steps`.

3. **Degradation fallback.** Given the LLM seam throws or times out, when `detect(...)` runs, then it
   falls back to `EquipmentMatcher` over the step text and returns `complete: false` with the matcher's
   explicit-mention equipment (per-type `defaultEssentiality`). No throw escapes the detector for a
   bad/empty LLM response — it degrades.

4. **Offline stub selected in tests.** Given no `OPENAI_API_KEY`, when the detector is constructed via
   its `select…()` factory, then the offline stub analyzer is used (returns no LLM equipment), so
   detection degrades to the deterministic matcher and tests never hit the network — mirroring
   `selectRecipeAnalyzer()`.

5. **Dedicated workflow step.** Given `import-workflow.ts`, when the workflow runs, then a new
   `equipmentStep` (`"use step"`, `maxRetries = 3`) runs **after** `categorizeStep` and **before**
   `dietStep`, best-effort per recipe (a per-recipe try/catch), attaching the detection result to each
   recipe and emitting one structured log line per recipe (`equipment=… complete=…`), matching the
   allergen/diet step logs.

6. **Persistence.** Given a detected recipe, when `persistStep` runs, then `recipe_steps.equipment`
   holds the per-step `Equipment[]` (null when none, like `techniques`), `recipe_equipment` holds one
   `(recipe_id, equipment, essentiality)` row per detected item (`onConflictDoNothing` for replay
   idempotency, like `insertDiets`), and `recipes.equipment_complete` reflects the detection. A withheld
   recipe (detector returned nothing) persists `equipment_complete = false` and zero `recipe_equipment`
   rows.

7. **findById returns equipment.** Given a persisted recipe, when `RecipeRepository.findById` reads it,
   then `recipe_steps.equipment` is available on the returned steps (so the "which step needs the air
   fryer" UI has its data). [ASSUMPTION: surfaced on the existing step read shape; no new API endpoint
   in this story — the ranked/deck read path is WI-EQ-3.]

8. **Best-effort isolation.** Given the detector throws for one recipe in a batch, when the step runs,
   then only that recipe is left unenriched (`equipment_complete = false`); the import still reaches
   `ready`.

9. **Green.** `npm test` + `npm run typecheck` pass, including the new unit + integration tests.

## Test Cases

### Test Case 1: EquipmentMatcher alias scan (unit, pure — mirrors difficulty.test.ts)

**Preconditions:** none.

**Steps:** `EquipmentMatcher.create().detect([...])` for:
`["Whisk eggs", "Cook in the air fryer at 400", "Blend until smooth"]`, and negatives
`["Add airfryerless note", "beat to peaks"]`.

**Expected Outcomes:** step 1 → `[]`; step 2 → `['air_fryer']`; step 3 → `['blender']`; roll-up union
`{air_fryer:recommended, blender:recommended}`; "airfryerless" → no match; "Air-Fryer" and "AIR FRYER"
both match; empty steps → all `[]`, empty roll-up.

### Test Case 2: EquipmentDetector vocab-constrains a stub analyzer (unit)

**Preconditions:** an injected analyzer stub returning
`{ equipment:[{type:'air_fryer',essentiality:'recommended'},{type:'toaster',essentiality:'required'}], stepEquipment:[['air_fryer'],['toaster']] }`.

**Steps:** `detector.detect(title, ings, steps)`.

**Expected Outcomes:** `toaster` (off-vocab) is dropped from both `equipment` and `stepEquipment`;
result is `air_fryer` recommended only; `complete: true`; `stepEquipment` aligned to `steps`.

### Test Case 3: EquipmentDetector degrades to matcher on LLM failure (unit)

**Preconditions:** an analyzer stub that throws; steps naming an air fryer explicitly.

**Steps:** `detector.detect(...)`.

**Expected Outcomes:** result equipment = `[{type:'air_fryer', essentiality:'recommended'}]` (matcher's
`defaultEssentiality`); `complete: false`; no throw.

### Test Case 4: Import persists equipment (integration — mirrors import-categorize.test.ts)

**Preconditions:** migrated `file:` db; offline (stub analyzer → matcher fallback); a recipe whose steps
name an air fryer.

**Steps:** Run the offline equipment attach + `persistAndReady`, then read back `recipe_equipment`,
`recipe_steps.equipment`, `recipes.equipment_complete`.

**Expected Outcomes:** `recipe_equipment` has an `air_fryer` row; the owning step's
`recipe_steps.equipment` contains `air_fryer`; a recipe naming nothing special persists zero
`recipe_equipment` rows. (`equipment_complete = false` under the offline matcher path — the design's
degraded coverage; a true `complete=true` requires the LLM tier, exercised only when a key is present.)

## Test Run

_To be filled during execution._

## Deployment Strategy

Code deploy after the WI-EQ-1 migration (EQUIPMENT-SIGNAL.md § Deployment order 2). Best-effort like its
sibling steps — a detector failure never fails an import. New imports populate equipment going forward;
existing recipes stay `equipment_complete = false` (filter lenient) until an optional backfill (order 3,
out of scope here). The LLM tier engages only where `OPENAI_API_KEY` is set; everywhere else the
deterministic matcher runs. No flag.

## Production Verification

### Production Verification 1: A real import detects and persists equipment

**Preconditions:** deployed; `OPENAI_API_KEY` present.

**Steps:** Import a recipe that clearly needs an air fryer; inspect `recipe_equipment`,
`recipe_steps.equipment`, `recipes.equipment_complete`, and the step log line.

**Expected Outcomes:** `air_fryer` row present with an essentiality; the owning step tagged;
`equipment_complete = true`; one `equipment=… complete=true` log line. A detector outage leaves the
recipe `equipment_complete = false` and the import still succeeds.

## Production Verification Run

_To be filled during execution._
