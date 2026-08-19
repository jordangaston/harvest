---
tags: [ranking-engine], tdd
summary: "Kitchen-equipment signal — per-step detection at import + hard filter in ranking"
locked: false
---

# Kitchen Equipment — Design

## Context

Some recipes need special appliances — an air fryer, slow cooker, pressure cooker, sous-vide, smoker.
A user who lacks the appliance can't make the dish, so it shouldn't fill their swipe deck. This adds
**kitchen equipment as the ninth ranking signal** and the **third hard filter**, alongside allergens
and diets (`DESIGN.md` § Ranking Algorithm). Like those, it carries no per-user weight — it gates the
candidate pool rather than scoring it.

Two halves:

- **(A) Detection at import** — determine the notable equipment each recipe step needs, matching the
  existing per-step technique-detection pattern (`recipe_steps.techniques`).
- **(B) Filter in ranking** — exclude recipes that *require* equipment the user doesn't own; softly
  penalize recipes that *recommend* substitutable equipment they lack.

This document extends `DESIGN.md`; read its § Ranking Algorithm and § Swipe deck first. Conventions
are drawn from the live pipeline: the WDK import workflow (`server/src/workflows/import-workflow.ts`),
the technique detector (`recipe_steps.techniques`), the allergen `complete` coverage flag, and diet
config-rules (`server/src/diet/diet-rules.ts`).

### Two design choices up front

- **Only "notable" appliances are tracked.** A controlled vocabulary of special equipment (air fryer,
  slow cooker, pressure cooker, sous-vide, smoker, stand mixer, blender, food processor, grill, wok,
  Dutch oven, deep fryer, ice-cream maker, waffle iron, …). **Baseline gear** every kitchen is assumed
  to have — oven, stovetop, microwave, pots, pans, knives, baking sheets — is **not** in the vocab and
  never filtered. Detecting "needs a knife" would filter nothing and annoy everyone.
- **Essentiality is judged per recipe by the LLM**, with a per-type config default as the fallback.
  Whether a slow cooker is *essential* (slow-cooking is the method) or merely *convenient* (it saves a
  step) depends on the recipe, not just the appliance — and whether a workable substitute exists is
  reasoning, not a lookup. The detector classifies each detected item `required` vs `recommended` for
  *that recipe*; a per-type default (sous-vide/smoker `required`, air-fryer/slow-cooker `recommended`)
  is the prior used only when the model is unavailable or unsure.

---

## Detection (import) design

### LLM-primary detection, deterministic fallback

Equipment is often **implicit** — a recipe titled "Air Fryer Wings" whose steps only say "cook at
400°F for 12 min," or "beat to stiff peaks" implying an electric mixer — and **essentiality and
substitutes need reasoning**, not a keyword hit. So the primary detector is a dedicated
**`EquipmentDetector`** — its own LLM call in its own pipeline step, with a prompt focused solely on
equipment (reading the title, ingredients, and steps). It emits, constrained to the `EQUIPMENT_TYPES`
vocab (dropping anything off-vocab, like the cuisine/technique constraint):

```json
{ "equipment": [ { "type": "air_fryer", "essentiality": "recommended", "substitute": "oven, 400°F" } ],
  "stepEquipment": [ [], ["air_fryer"], [] ] }
```

- `type` — the appliance, vocab-constrained; includes implicit gear the model infers from context.
- `essentiality` — `required` vs `recommended` **for this recipe** (the substitutability judgment).
- `substitute` — an optional free-text note for the UI (captured cheaply while the model is already
  reasoning; not used by the filter). See Q-E5.
- `stepEquipment` — per-step alignment (like `stepTechniques`) for the "which step needs it" UI.

**Deterministic alias matching is the degradation fallback**, per the pipeline's tiered-fallback rule
(default cheap/reliable, escalate on the failure signature — here inverted: LLM primary, keyword floor
on failure). When the LLM call fails or times out, a word-boundary scan over step text still catches
**explicit** mentions, so we emit something rather than nothing — but `equipment_complete = false`, so
the filter stays lenient (§ Ranking integration). The alias table also seeds the LLM's vocab and
supplies the per-type essentiality **prior**:

```ts
// server/src/equipment/equipment.ts  (config, like diet-rules.ts / technique-difficulty.ts)
export interface EquipmentType {
  canonical: Equipment;                    // enum value, from schema tuple EQUIPMENT_TYPES
  defaultEssentiality: 'required' | 'recommended';  // fallback prior; the LLM decides per recipe
  aliases: string[];                       // surface forms for the keyword fallback + LLM hint
}

export const EQUIPMENT: EquipmentType[] = [
  { canonical: 'air_fryer',       defaultEssentiality: 'recommended', aliases: ['air fryer', 'air-fryer', 'airfryer'] },
  { canonical: 'slow_cooker',     defaultEssentiality: 'recommended', aliases: ['slow cooker', 'crock pot', 'crockpot'] },
  { canonical: 'pressure_cooker', defaultEssentiality: 'recommended', aliases: ['pressure cooker', 'instant pot', 'instapot'] },
  { canonical: 'stand_mixer',     defaultEssentiality: 'recommended', aliases: ['stand mixer', 'kitchenaid'] },
  { canonical: 'blender',         defaultEssentiality: 'recommended', aliases: ['blender'] },
  { canonical: 'food_processor',  defaultEssentiality: 'recommended', aliases: ['food processor'] },
  { canonical: 'grill',           defaultEssentiality: 'recommended', aliases: ['grill', 'barbecue', 'bbq'] },
  { canonical: 'dutch_oven',      defaultEssentiality: 'recommended', aliases: ['dutch oven'] },
  { canonical: 'deep_fryer',      defaultEssentiality: 'recommended', aliases: ['deep fryer', 'deep-fry'] },
  { canonical: 'wok',             defaultEssentiality: 'recommended', aliases: ['wok'] },
  { canonical: 'sous_vide',       defaultEssentiality: 'required',    aliases: ['sous vide', 'sous-vide', 'immersion circulator'] },
  { canonical: 'smoker',          defaultEssentiality: 'required',    aliases: ['smoker'] },
  { canonical: 'ice_cream_maker', defaultEssentiality: 'required',    aliases: ['ice cream maker', 'ice-cream maker'] },
  { canonical: 'waffle_iron',     defaultEssentiality: 'required',    aliases: ['waffle iron', 'waffle maker'] },
];
```

The `defaultEssentiality` priors are a **calibration knob**; adding an appliance is one config line +
one tuple value, no migration. Equipment runs as its **own pipeline step** with a focused prompt — not
folded into the categorizer call — so each prompt stays single-purpose and the step retries
independently (Decisions).

### The import step

A new best-effort **`equipmentStep`** — its own `"use step"` function running its own
`EquipmentDetector` LLM call — added to the WDK workflow after `categorizeStep` (so the dish type is
available as a cue):

```
fetch → resolve → nutrition → cost → allergen → categorize → equipment → diet → persist
```

Per recipe the detector returns `equipment: { type, essentiality }[]` (the recipe-level set with
per-recipe essentiality) plus `stepEquipment: Equipment[][]` (aligned to steps, like `stepTechniques`).
On LLM failure, the deterministic alias fallback fills `equipment` from explicit mentions with the
per-type `defaultEssentiality`, and sets `equipment_complete = false`. Persist writes both:

- **Per step** on `recipe_steps.equipment` (JSON array) — "which step needs the air fryer" in the UI,
  satisfying the "each step" requirement.
- **Rolled up** into the `recipe_equipment` join table, `(recipe_id, equipment, essentiality)` — the
  set the filter reads.

A `recipes.equipment_complete` flag records a successful detection (mirrors `allergens_complete`). It
distinguishes "detected, needs nothing special" (`true`, empty set) from "never processed or LLM
failed" (`false`/absent) — the filter treats the latter as *unknown* and stays lenient (§ Ranking
integration). Best-effort like its siblings: on any error, leave the recipe unenriched
(`equipment_complete = false`), never fail the import.

## Use Case Implementations

### Detect Equipment At Import — Implements F-E1

~~~mermaid
sequenceDiagram
    participant W as importWorkflow
    participant E as equipmentStep
    participant D as EquipmentDetector (LLM)
    participant M as EquipmentMatcher (fallback)
    participant P as persistStep
    participant DB as recipes / recipe_steps / recipe_equipment

    W->>E: equipmentStep(recipes, input)
    loop each recipe (best-effort)
    E->>D: detect(title, ingredients, steps)
    alt LLM ok
    D-->>E: equipment[{type,essentiality}] + stepEquipment (vocab-constrained)
    else LLM failed
    E->>M: detect(steps[]) — explicit mentions only
    M-->>E: equipment (defaultEssentiality), complete=false
    end
    end
    E-->>W: recipes + equipment + essentiality + equipmentComplete
    W->>P: persistStep(recipes)
    P->>DB: recipe_steps.equipment (per step), recipe_equipment (recipe_id, equipment, essentiality), recipes.equipment_complete
~~~

### Equipment Filter In Ranking — Implements F-E2 (extends `DESIGN.md` F-01)

~~~mermaid
sequenceDiagram
    participant E as RankingEngine
    participant F as EquipmentFilter
    participant P as UserPreferences

    rect rgb(255, 248, 240)
    note over E,F: Hard filter phase (adds to allergen + diet filters)
    E->>F: excludes(recipe, prefs)?
    alt not prefs.equipmentReviewed
    F-->>E: false  (kitchen unknown → never filter)
    else recipe.equipmentComplete AND a REQUIRED item ∉ prefs.ownedEquipment
    F-->>E: true  (exclude — can't make it)
    else
    F-->>E: false  (owned, or only recommended-missing → soft penalty in scoring)
    end
    end
~~~

---

## Ranking integration

Equipment is a **hard filter + soft penalty**, exactly mirroring allergen severity and diet strictness
(`DESIGN.md` §§ Hard filters, Soft penalties). It has **no per-user weight**.

**Hard filter — `EquipmentFilter`** (new `FilterRule` in the engine registry):

```
excludes(recipe, prefs):
  if not prefs.equipmentReviewed:            return false   # kitchen unknown → don't hide anything
  if not recipe.equipmentComplete:           return false   # detection unknown/failed → lenient
  for { equipment, essentiality } in recipe.equipment:      # essentiality is the per-recipe LLM judgment
    if essentiality == 'required' and equipment ∉ prefs.ownedEquipment:
      return true                                            # exclude — non-substitutable & absent
  return false
```

**Soft penalty** (added to `DESIGN.md`'s penalty table, applied after the weighted average, floored at
0): a flat **−0.10** if `prefs.equipmentReviewed` and the recipe has any `recommended` equipment the
user doesn't own (substitutable, but they'd have to adapt). Flat, not per-item, to avoid burying a
recipe that merely suggests two gadgets. Tunable.

**Gating & cold-start.** The filter and penalty engage **only when `equipment_reviewed` is true** — a
per-user flag set when the user reviews their kitchen (onboarding or settings), even if they own
nothing. Until then the signal is inert: we never hide a recipe from someone who simply hasn't told us
what they own. This is the same "no data → no filter" stance as allergens (no declared allergens → no
allergen filter). A recipe whose equipment was never detected (`equipment_complete = false`) is treated
as unknown and not excluded — tiered-fallback leniency, since over-filtering hides good food.

### Worked example

**User** — `equipment_reviewed = true`, owns `{ slow_cooker, blender }`.

| Recipe | Detected equipment (essentiality) | Outcome |
| --- | --- | --- |
| A — Sous-vide steak | `sous_vide` (required) | **Excluded** — required, not owned |
| B — Air-fryer wings | `air_fryer` (recommended) | Kept, **−0.10** soft penalty (oven substitute) |
| C — Slow-cooker chili | `slow_cooker` (required-or-recommended, owned) | Kept, no penalty |
| D — Sheet-pan salmon | none (baseline oven only) | Kept, no penalty |
| E — Smoked brisket, `equipment_complete = false` | `smoker` present but detection incomplete | Kept (lenient — unknown coverage) |

Had the same user `equipment_reviewed = false`, **all five** are kept and unpenalized.

---

## Entities

~~~mermaid
classDiagram
    class Recipe {
        +Equipment[] equipment
        +bool equipmentComplete
    }
    class RecipeStep {
        +int position
        +string text
        +Equipment[] equipment
    }
    class UserPreferences {
        +Equipment[] ownedEquipment
        +bool equipmentReviewed
    }
    class EquipmentType {
        +Equipment canonical
        +Essentiality essentiality
        +string[] aliases
    }
    Recipe "1" --> "*" RecipeStep : has
    Recipe "1" --> "*" Equipment : needs (rolled-up)
    UserPreferences "1" --> "*" Equipment : owns
~~~

`Equipment` is the enum; `EquipmentType` (config) attaches essentiality + aliases to each value.

---

## Tables

New controlled tuple in `schema.ts` (like `MAJOR_ALLERGENS`):
`EQUIPMENT_TYPES = ['air_fryer','slow_cooker','pressure_cooker','stand_mixer','blender','food_processor','grill','dutch_oven','deep_fryer','wok','sous_vide','smoker','ice_cream_maker','waffle_iron'] as const`.

## recipe_equipment

The rolled-up set the filter reads. Mirrors `recipe_categories` / `recipe_diets`.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| recipe_id | text | fk → recipes.id, cascade | |
| equipment | text (enum) | not null | `EQUIPMENT_TYPES` |
| essentiality | text (enum) | not null | `['required','recommended']` — the LLM's per-recipe judgment (config default on fallback) |

Primary key `(recipe_id, equipment)`. Index `(equipment)` for "recipes needing X". Essentiality is
stored **per recipe** because substitutability is a recipe-level judgment (slow-cooking as the method
vs. a convenience), not a fixed property of the appliance.

## recipe_steps — change

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| equipment | text (json) | null | `Equipment[]` for this step; null when none (like `techniques`) |

## recipes — change

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| equipment_complete | integer (boolean) | not null, default false | detection ran (distinguishes "needs nothing" from "not processed"), like `allergens_complete` |

## user_equipment

What the user owns. Mirrors `user_allergens`.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| user_id | text | fk → users.id, cascade | |
| equipment | text (enum) | not null | `EQUIPMENT_TYPES` |

Primary key `(user_id, equipment)`.

## user_preferences — change

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| equipment_reviewed | integer (boolean) | not null, default false | gates the equipment filter; true once the user reviews their kitchen |

---

## Modules

~~~mermaid
classDiagram
    class EquipmentDetector {
        +detect(title, ingredients, steps) DetectedEquipment
    }
    class EquipmentMatcher {
        +detect(steps: string[]) StepEquipment
    }
    class FilterRule {
        <<interface>>
        +excludes(recipe, prefs) boolean
    }
    class EquipmentFilter {
        +excludes(recipe, prefs) boolean
    }
    class EQUIPMENT_config {
        +defaultEssentiality(Equipment) Essentiality
        +aliasesFor(Equipment) string[]
    }
    FilterRule <|.. EquipmentFilter
    EquipmentDetector --> EQUIPMENT_config : vocab + prior (in prompt)
    EquipmentMatcher --> EQUIPMENT_config : alias table (fallback)
    EquipmentDetector ..> EquipmentMatcher : degrades to (on LLM failure)
~~~

`EquipmentDetector` is the **primary** detector — a dedicated LLM step with its own focused prompt
(like `NutritionEstimator` / `RecipeCategorizer`), run from `equipmentStep`; `EquipmentMatcher` is the
pure, unit-testable **fallback** (string in, equipment out) for LLM failures. `EquipmentFilter`
reads the **per-recipe** essentiality off `recipe_equipment` (no config lookup at rank time) and joins
the engine's existing `FilterRule[]` registry (`DESIGN.md` § Modules) — one array entry, no engine
change. `UserPreferences` (from WI-RANK-1) gains `ownedEquipment: Equipment[]` and `equipmentReviewed:
boolean`, folded in by `PreferenceRepository`.

---

## Traceability

| Stored attribute | Feeds signal | As |
| --- | --- | --- |
| `user_equipment.equipment` | Equipment | the owned set (filter membership) |
| `user_preferences.equipment_reviewed` | Equipment | gate (filter engages only when true) |
| `recipe_equipment.equipment` | Equipment | the recipe's required/recommended set |
| `recipes.equipment_complete` | Equipment | coverage — lenient when false |

| Signal | Backing preference | Weight? |
| --- | --- | --- |
| Equipment | `user_equipment` + `equipment_reviewed` | none — hard filter, like allergens/diet |

Consistent with `DESIGN.md`: the two other hard filters (allergens, diet) also carry no weight. A
positive equipment *preference* ("I love my air fryer, show me more") would be a distinct weighted soft
signal — see Q-E2.

---

## Testing

| Use Case | Type | Unit | Integration |
| --- | --- | --- | --- |
| F-E1 Detect Equipment At Import | Flow | | x |
| F-E2 Equipment Filter | Op | x | |
| EquipmentMatcher detection | — | x | |

- **Analyzer equipment output** (unit): the LLM result is vocab-constrained (off-vocab types dropped)
  and essentiality-validated, like the cuisine/technique constraint — tested with an offline analyzer
  stub (tests never hit the network), not by calling a model. On a stub failure the code falls back to
  the matcher and sets `equipment_complete=false`.
- **`EquipmentMatcher`** (unit, pure — the fallback): aliases match case-insensitively on word
  boundaries ("Air Fryer", "instant pot"); "airfryerless"-style substrings don't false-match;
  empty/none → `[]`; per-step output aligns to step count; roll-up is the union.
- **`EquipmentFilter`** (unit): `equipment_reviewed=false` → never excludes; required-missing → excludes;
  recommended-missing → does not exclude (penalty is in scoring); owned → keeps; `equipment_complete=false`
  → keeps (lenient). Plus the soft-penalty branch in the engine (flat −0.10 once, floored at 0).
- **Import** (integration): import a recipe whose steps name an air fryer → `recipe_equipment` has
  `air_fryer`, the owning step's `recipe_steps.equipment` contains it, `equipment_complete=true`.
- **End-to-end deck** (integration): the worked-example table — a reviewed user without a sous-vide
  never sees recipe A in the deck; sees B ranked lower than C/D.

## Deployment

| Order | Type | Description | Backwards-compatible |
| --- | --- | --- | --- |
| 1 | schema | `recipe_equipment`, `user_equipment` tables; `recipe_steps.equipment`, `recipes.equipment_complete`, `user_preferences.equipment_reviewed` columns | yes — additive |
| 2 | code | `EquipmentMatcher`, `equipmentStep` in the workflow, `EquipmentFilter` in the engine, prefs fold-in | yes |
| 3 | backfill (optional) | re-run detection over existing recipes to set `equipment_complete` + populate sets | online, best-effort |

Existing recipes have `equipment_complete=false` until backfilled, so the filter stays lenient on them
— safe to ship before the backfill. New imports populate it going forward.

## Monitoring

| Name | Type | Use Case | Description |
| --- | --- | --- | --- |
| equipment_detect_count | counter | F-E1 | recipes processed by the step |
| equipment_filtered_ratio | histogram | F-E2 | fraction of a reviewed user's catalog removed by the equipment filter; a spike flags over-filtering (a mis-classified `required`) |

One structured log line per recipe in the step (`equipment=… complete=…`), matching the allergen/diet
step logs.

---

## Decisions

### Hard filter + per-recipe essentiality, no per-user weight

**Framework:** Direct criterion — match the user's ask ("filter by what you have") and the existing
hard-filter pattern. Equipment you lack is a physical constraint, not a taste; it gates rather than
scores. Essentiality (`required` vs `recommended`) is the allergen-severity / diet-strictness analog
that keeps substitutable gear from over-filtering. It is judged **per recipe** (stored on
`recipe_equipment`) because substitutability is recipe-level — slow-cooking as the *method* vs. a
convenience — not a fixed property of the appliance; a per-type config default is only the fallback.

**Choice:** `EquipmentFilter` in the hard-filter phase reading per-recipe essentiality;
`recommended`-missing → flat soft penalty; no weight.

**Alternatives considered:** *Weighted soft signal* — rejected: you can't "mostly" own an air fryer;
absence is binary. *Type-level essentiality only* — rejected: it mis-judges the method-vs-convenience
cases the LLM catches.

### LLM-primary detection, deterministic fallback

**Framework:** Direct criterion — recall + reasoning. Equipment is often **implicit** (title/context,
not a keyword in every step) and substitutability is a **judgment**, so a keyword-only matcher is a
high-precision/low-recall floor, not a primary. The recipe-analysis LLM already reads title +
ingredients + steps, so it detects implicit gear and judges per-recipe essentiality at little marginal
cost. Deterministic alias matching is retained as the **degradation fallback** (tiered-fallback: emit
explicit mentions when the LLM fails, mark `equipment_complete=false` so the filter stays lenient).

**Choice:** a dedicated `equipmentStep` running its own `EquipmentDetector` LLM call; `EquipmentMatcher`
on failure only.

**Alternatives considered:** *Keyword matcher as primary* — rejected (this doc's first draft): misses
implicit equipment and can't reason about substitutes. *Folding equipment into the categorizer call* —
rejected: one prompt doing cuisine + technique + equipment + essentiality + substitutes dilutes both
tasks; a single-purpose, separately-tunable prompt and an independently-retryable step are worth the
extra call — the pipeline is already a chain of one-concern steps.

---

## Open Questions / Future

| ID | Question | Status | Resolution |
| --- | --- | --- | --- |
| Q-E1 | Where do users declare owned equipment and set `equipment_reviewed` — onboarding, settings, or inferred from likes? | open | Product/UX; the data model is ready either way. |
| Q-E2 | Add a positive equipment *preference* soft signal ("prefer air-fryer recipes"), with a per-user weight, distinct from the ownership filter? | open | Future weighted signal; would extend the roster, not the filter. |
| Q-E3 | Per-recipe essentiality (slow-cooking as the method vs. a convenience). | resolved | Now core: the LLM judges it per recipe, stored on `recipe_equipment.essentiality`; config default is the fallback. |
| Q-E4 | Reuse the taste-classifier call for equipment, or a dedicated equipment LLM step? | resolved | Dedicated `equipmentStep` / `EquipmentDetector` — a single-purpose prompt and an independently-retryable step, at the cost of one extra LLM call. |
| Q-E5 | The LLM already emits a `substitute` note per `recommended` item — surface it in the UI ("make it in the oven instead") instead of a silent down-rank? | open | UI enhancement; the data is captured at detection, so no re-call needed. |
| Q-E6 | How do we evaluate equipment-detection accuracy (implicit gear especially) — a labeled recipe set + `equipment_complete` / mis-filter monitoring? | open | Needed before trusting the hard-exclude; start lenient and watch `equipment_filtered_ratio`. |

---

## Appendix A — Changelog

| Date | Author | Change |
| --- | --- | --- |
| 2026-08-18 | Jordan Gaston | Initial design — kitchen-equipment signal: per-step detection at import + hard filter (+ soft penalty) in ranking |
| 2026-08-18 | Jordan Gaston | Revised detection to LLM-primary (implicit equipment + per-recipe essentiality/substitutes); demoted deterministic alias matching to the degradation fallback; moved essentiality onto `recipe_equipment` per recipe (was a type-level config default) |
| 2026-08-18 | Jordan Gaston | Resolved Q-E4: equipment detection is its own dedicated `equipmentStep` / `EquipmentDetector` LLM call (a single-purpose prompt, independently retryable), not folded into the categorizer call |
