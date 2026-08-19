---
tags: [ranking-engine], tdd
summary: "Meal-prep suitability — a weighted soft signal that boosts batch-friendly recipes for users who meal-prep"
locked: false
---

# Meal Prep — Design

## Context

Some recipes are built for meal prep — batch-cooked, portioned into containers, they keep and reheat
for days. Some users want exactly that. This adds **meal-prep suitability as the tenth ranking signal**:
a per-recipe score of how well a recipe suits meal prep, weighted by how much each user cares.

Unlike kitchen equipment (a hard filter — a physical constraint), meal prep is a **pure weighted soft
signal**, a boost, never a filter. A romantic-dinner recipe isn't *wrong*; it just shouldn't top the
deck of someone whose goal is stocking the fridge for the week. So it behaves like the existing soft
signals (cost, nutrition, affinity…): a normalized per-recipe score `s ∈ [0,1]` multiplied by a
per-user weight in the weighted average (`DESIGN.md` § Ranking Algorithm). No new tables, no filter —
one recipe column and one weight column.

It has the cleanest cold-start hook of any signal: the **`meal_prepping` onboarding goal already
exists** on `users.goals`, so it seeds the weight directly, exactly like `save_money → weight_cost`.

This document extends `DESIGN.md`; read its § Ranking Algorithm (signal roster, weights, cold start).

## Suitability as an ordinal band

Meal-prep fit is captured as a **three-band classification**, not a raw 0–1 float — LLMs classify far
more reliably than they fine-grained-score, and a band mirrors the difficulty-band precedent:

| `meal_prep_fit` | Means | Score `s` |
| --- | --- | --- |
| `designed` | Built for it — batch quantities, "make-ahead," "meal prep," stores/freezes, portioned | **1.00** |
| `suitable` | Works fine prepped — stews, curries, grain bowls, roasts that keep and reheat | **0.60** |
| `unsuitable` | Degrades — fried/crispy, delicate, eat-immediately, single-serving plating | **0.15** |

The score map is a **calibration knob** (config, tunable). `unsuitable` is `0.15`, not `0`, so an
ill-suited recipe is down-weighted, not buried. Null (unscored) → the signal is *unavailable* and drops
out of the weighted average, like any other soft signal with missing data.

## Detection (import)

"Designed for meal prep" is partly **explicit intent** (the author says so, "great for meal prep") and
partly **implicit suitability** (dish type keeps well, servings scale, steps mention storing/freezing).
Both are a judgment, so — as with equipment essentiality — detection is **LLM-primary**, extending the
existing taste-classifier call (which already reads title + ingredients + steps), constrained to the
three bands. It weighs structured cues the recipe already carries:

- **Servings** — a high yield signals batch intent.
- **Dish type** (from the categorizer) — `stew`/`curry`/`casserole`/`bowl`/`soup` keep well; `salad`/
  fried/`pastry`/`ice_cream` don't.
- **Storage cues** in steps/notes — "keeps 5 days," "freezer-friendly," "reheat," "make ahead."
- **Explicit intent** in title/notes — "meal prep," "batch," "make-ahead."

**Deterministic fallback** (LLM failure): a heuristic prior from the structured cues alone — dish type
in the keeps-well set **and** servings ≥ a threshold → `suitable`, else `unsuitable`; never `designed`
(explicit intent needs the model). On fallback, still store the band but flag low confidence so it can
be re-scored later (Q-MP4). Best-effort like every enrichment step — never fails the import. Rides the
categorizer call (reuse-first; a dedicated step if the combined prompt degrades — Q-MP3).

## Use Case Implementations

### Boost Meal-Prep Recipes — Implements F-MP1 (extends `DESIGN.md` F-01, scoring phase)

~~~mermaid
sequenceDiagram
    participant E as RankingEngine
    participant S as MealPrepScorer
    participant P as UserPreferences

    rect rgb(240, 248, 255)
    note over E,S: Soft-signal scoring (joins the SignalScorer registry)
    E->>S: weight(prefs)  → prefs.weights.mealPrep
    E->>S: score(recipe)  → { designed:1.0, suitable:0.6, unsuitable:0.15 }[recipe.mealPrepFit] or null
    S-->>E: (wᵢ, sᵢ)
    note over E: folded into Σwᵢ·sᵢ / Σwᵢ like every soft signal
    end
~~~

## Ranking integration

A new `SignalScorer` — `MealPrepScorer` — joins the engine's registry (`DESIGN.md` § Modules). One
array entry; the weighted-average machinery is unchanged.

- `weight(prefs) = prefs.weights.mealPrep` — the per-user weight (0–3).
- `score(recipe) = SCORE[recipe.mealPrepFit]` (the band map above), or `null` when unscored.
- No normalization step — the band map already yields `s ∈ [0,1]`.

**Weight & cold-start.** `weight_meal_prep` is a new 0–3 weight column on `user_preferences`. Cold-start
seeds it from goals: **`meal_prepping` → 3**, extending `DESIGN.md`'s goal→weight table (which already
does `save_money → weight_cost`, `eat_healthier → weight_nutrition`). Absent the goal it defaults to
`1` — the uniform baseline — so meal-prep fit nudges every deck slightly toward batch-friendly food but
only *dominates* for users who declared the goal. (Whether the neutral default should instead be `0`,
i.e. pure opt-in, is Q-MP1.)

**Where a stated preference becomes a number:** same as the rest — the onboarding importance answer (or
the `meal_prepping` goal) maps to the integer weight at persist time. The recipe's *fit* is detected;
the user's *care* is the weight.

### Worked contribution

Two recipes for **a meal-prepper** (`weight_meal_prep = 3`; other weights per Alice in `DESIGN.md`, so
`Σw = 14` with this signal added). Holding the other five soft signals equal at `s = 0.7` for both:

| Recipe | `meal_prep_fit` | meal-prep term | other terms | score |
| --- | --- | --- | --- | --- |
| P — "High-protein meal-prep bowls" | `designed` (1.00) | 3·1.00 = 3.00 | 11·0.7 = 7.70 | 10.70/14 = **76.4** |
| Q — "Crispy soufflé for two" | `unsuitable` (0.15) | 3·0.15 = 0.45 | 11·0.7 = 7.70 | 8.15/14 = **58.2** |

An **18-point** swing from the meal-prep signal alone — the boost the founder asked for. For a user
with `weight_meal_prep = 1`, the same two recipes sit ~4 points apart: present, but not dominant.

## Data model

No new tables. Two columns, mirroring `nrf_score` (recipe) and the `weight_*` columns (prefs).

### recipes — change

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| meal_prep_fit | text (enum) | null | `['unsuitable','suitable','designed']`; null until scored at import |

### user_preferences — change

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| weight_meal_prep | integer | not null, default 1 | 0–3; seeded to 3 by the `meal_prepping` goal at cold-start |

`MEAL_PREP_FITS = ['unsuitable','suitable','designed'] as const` — a schema tuple like
`DIFFICULTY_BANDS`. A "meal-prep friendly" **UI badge** can threshold on `fit === 'designed'` (or
`≥ suitable`); no separate flag needed.

## Traceability

| Stored attribute | Feeds signal | As |
| --- | --- | --- |
| `recipes.meal_prep_fit` | Meal prep | the per-recipe suitability (→ score) |
| `user_preferences.weight_meal_prep` | Meal prep | the per-user weight (importance) |

| Signal | Backing preference | Weight? |
| --- | --- | --- |
| Meal prep | `weight_meal_prep` (seeded by the `meal_prepping` goal) | yes — a weighted soft signal |

Consistent with `DESIGN.md`: like nutrition, meal prep needs no separate "target" attribute — the
recipe's `fit` supplies the score, the weight supplies the importance.

## Modules

`MealPrepScorer` implements the existing `SignalScorer` interface (`DESIGN.md` § Modules) — pure, no
I/O, a band-map lookup. Detection extends the `RecipeAnalyzer` (the same call that gained equipment),
with a heuristic fallback. `UserPreferences` (WI-RANK-1) gains `weights.mealPrep`; `PreferenceRepository`
folds the column in and seeds it at cold-start.

## Testing

| Use Case | Type | Unit |
| --- | --- | --- |
| F-MP1 Boost Meal-Prep Recipes | Op | x |
| MealPrepScorer | — | x |
| Cold-start seeding | — | x |

- **`MealPrepScorer`** (unit, pure): each band → its score; null fit → null (drops from the average);
  weight reads `prefs.weights.mealPrep`.
- **Combination** (unit): the worked example — a `designed` recipe outscores an `unsuitable` one by the
  expected margin at weight 3, and by a small margin at weight 1.
- **Cold-start** (unit): a user with `goals` containing `meal_prepping` resolves `weight_meal_prep = 3`;
  without it, `1`.
- **Detection** (unit): the analyzer's band output is validated to the enum (off-enum → null), tested
  with an offline stub; the heuristic fallback maps keeps-well dish types + high servings → `suitable`,
  never `designed`.

## Deployment

| Order | Type | Description | Backwards-compatible |
| --- | --- | --- | --- |
| 1 | schema | `recipes.meal_prep_fit`, `user_preferences.weight_meal_prep` columns | yes — additive |
| 2 | code | `MealPrepScorer` in the registry, analyzer band output, cold-start seed | yes |
| 3 | backfill (optional) | re-score existing recipes' `meal_prep_fit` | online, best-effort |

Unscored recipes (`meal_prep_fit = null`) simply omit the signal until backfilled — safe to ship before
the backfill. Existing users' `weight_meal_prep` defaults to 1; a later pass could re-seed from stored
goals.

## Monitoring

| Name | Type | Use Case | Description |
| --- | --- | --- | --- |
| meal_prep_scored_count | counter | F-MP1 | recipes assigned a `meal_prep_fit` at import |
| meal_prep_fit_distribution | histogram | F-MP1 | share of `designed`/`suitable`/`unsuitable` — a skew (e.g. everything `suitable`) flags a mis-calibrated classifier |

## Decisions

### Weighted soft signal, not a filter

**Framework:** Direct criterion — match the ask ("boost… for them"). Meal-prep suitability is a mode
the user opts into, not a constraint; a non-prep recipe must never be hidden, only ranked lower for
prep-minded users. That is exactly the weighted-average soft-signal shape, gated by a per-user weight
that most users leave near neutral.

**Choice:** `MealPrepScorer` in the soft-signal registry with a `weight_meal_prep`; no filter.

**Alternatives considered:** *Hard filter ("meal-prep only" mode)* — rejected for ranking (it's a
view/toggle, not a ranking signal); could exist as a separate explicit filter later. *A universal
boost with no weight* — rejected: meal-prep fit isn't universally desirable (a dinner party), so it must
be user-gated.

### Ordinal band, not a raw 0–1 score

**Framework:** Direct criterion — reliability. LLMs classify into a few bands far more consistently than
they emit a calibrated float, and a band mirrors `difficulty_band`. The three bands also map cleanly to
product language ("designed for meal prep" = the badge).

**Choice:** `meal_prep_fit ∈ {unsuitable, suitable, designed}` → a tunable score map.

## Open Questions / Future

| ID | Question | Status | Resolution |
| --- | --- | --- | --- |
| Q-MP1 | Neutral default weight — `1` (mild universal lean toward batch-friendly food) or `0` (pure opt-in for meal-preppers)? | open | Ship `1` for consistency with other signals; revisit if non-preppers report too many casseroles. |
| Q-MP2 | Decompose `fit` into sub-attributes (batchable / fridge-keeps / freezes / portioned) for a richer score and better badges? | open | Start with one band; decompose if users want to filter on "freezer-friendly" specifically. |
| Q-MP3 | Reuse the categorizer LLM call for the band, or a dedicated step? | open | Reuse first; split if the combined prompt's quality drops (same as equipment Q-E4). |
| Q-MP4 | Fallback-scored recipes (LLM failed → heuristic band) — track confidence and re-score later? | open | Flag low-confidence bands; a re-score pass when the model is available. |
| Q-MP5 | Distinguish fridge-days from freezer-friendly, and surface "keeps N days" to the user? | open | Future sub-attribute + UI; the LLM can emit it in the same call. |

## Appendix A — Changelog

| Date | Author | Change |
| --- | --- | --- |
| 2026-08-18 | Jordan Gaston | Initial design — meal-prep suitability as a weighted soft signal (signal #10): LLM-classified `meal_prep_fit` band × `weight_meal_prep` seeded by the `meal_prepping` goal; no new tables, no filter |
