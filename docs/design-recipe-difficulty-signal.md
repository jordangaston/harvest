---
tags: [harvest, ranking], tdd
summary: "Recipe difficulty signal — technical design document"
locked: false
---

# Recipe Difficulty Signal — Design

The recipe-side input to the ranking engine's difficulty signal. At ingest, compute a **per-step
difficulty** for every step, then aggregate them (with a few recipe-level features) into one
**continuous difficulty score** (0–100) bucketed into three display **bands** — `beginner`,
`intermediate`, `advanced`. The per-step difficulty — each step's hardest cooking technique on a 1–5
scale — is the **atomic signal, stored on each step row**; the recipe score is a **deterministic
additive blend** of the step-difficulty peak, step count, ingredient count, and total time. No LLM,
no network — a pure function over data the pipeline already resolved, plus one hand-built
technique-difficulty table.

Difficulty is stored at **both levels**: the atomic per-step value on each step, aggregated up to the
recipe score + band. This follows the store-at-lowest-useful-granularity rule — the per-step signal
is the foundation, the recipe rollup is a derivation of it. It also makes the score explainable (the
ranking, or a future UI, can point at *which* step made a recipe advanced) and lets the aggregate be
recomputed or re-weighted without re-scanning step text.

**In scope:** the per-step difficulty on each step, the recipe score + band that aggregate it, and
the step that derives them all.
**Out of scope:** the ranking engine itself (it does not exist yet — recipes list newest-first),
signal weighting/blending, and any per-user personalization. This document produces the signal a
later ranking reads; it does not read it. It mirrors the framing of
`docs/design-recipe-categorization-signal.md`.

The design is deliberately **underwhelming**: no learned model, no clever graph parsing, no second
LLM. That is a finding, not a shortcut — the research below shows every credible difficulty model is
a hand-tuned additive score over counts + a manual technique taxonomy, and that **no validated
ground-truth difficulty model exists to train against**. We ship the simplest defensible version and
leave a calibration knob for the one thing a minimal model can't see: whether the bands feel right.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Backend Tech Lead (author) | in_progress | |
| Architect | not_started | |
| Founder | not_started | |

---

# Research Grounding

Deep research (five angles, adversarially verified, sources cited) surfaced four load-bearing facts.
Full report and refuted-claim log: `docs/sprint-difficulty/research-report.md`.

1. **No validated recipe-difficulty model exists.** Everywhere "difficulty" appears in an ML
   pipeline it is an *input feature* for a different target (popularity, rating), never a validated
   *output* with reported accuracy against human labels. Consumer sites (BBC Good Food's
   *Easy / More effort / A challenge*; The Recipe Critic's tiered rubric) assign labels editorially,
   with no published validation. Buykx's PhD thesis states outright: *"there is no objective measure
   of recipe difficulty"*
   ([Buykx thesis](https://etheses.whiterose.ac.uk/id/eprint/5158/1/Lucy%20Buykx%20accepted%20thesis.pdf),
   [BBC Good Food](https://www.bbcgoodfood.com/recipes/collection/easy-dinner-recipes),
   [The Recipe Critic](https://therecipecritic.com/recipe-skill-levels/)). **Implication:** a learned
   model has nothing to learn from. Use a deterministic feature score.

2. **The one indirectly-validated formula is a small, additive, count-based blend.** Müller &
   Bergmann (2017) define `complexity → [0,5]` as the *unweighted sum* of five [0,1]-normalized
   criteria: ingredient count, step count, an ingredient-processing ratio, average per-step technique
   complexity (from a hand-annotated taxonomy), and total duration — bucketed into five bands. Their
   retrieval experiment showed the score is a real, separable, tunable knob
   ([Müller & Bergmann 2017](https://ceur-ws.org/Vol-2028/paper26.pdf)). Peterson (2025) reaches the
   same additive shape from a recipe-DAG and — critically — finds **action/technique count and step
   count are the actual differentiators**, and buckets by **dataset percentiles (P50/P85)** rather
   than hardcoded cutoffs ([Peterson thesis](https://colepeterson.me/docs/Cole_T_Peterson_MSCS_Thesis.pdf)).

3. **Technique difficulty comes from a hand-built lookup table, not NLP inference.** Both credible
   production-grade systems — Müller & Bergmann's WikiTaaable taxonomy and Yummly's difficulty patent
   ([US 9,489,377](https://patents.google.com/patent/US9489377)) — score technique from a small
   manually-curated table (technique → difficulty), not a learned model. This is the single
   highest-leverage, lowest-effort piece: a few dozen techniques (blanch, poach, temper, laminate vs.
   stir, boil, mix) covers most recipes.

4. **Ingredient rarity is *not* a validated difficulty signal.** No paper or product defines a
   standalone ingredient-rarity/availability difficulty score; rarity only ever appears as a
   byproduct of *substitution* or *recommendation-similarity* work
   ([arXiv 2302.07960](https://arxiv.org/pdf/2302.07960)). The research's explicit recommendation:
   *"don't try to build a rarity score from scratch — there's no precedent to copy… treat it as a
   separate, clearly-labeled signal, not folded silently into difficulty."* A hard-to-*source*
   ingredient is a shopping problem, not a cooking-skill problem. This directly bears on the founder's
   hypothesis (next section).

Two cautions carried forward: **percentile bands, not fixed cutoffs** (thresholds tuned to someone
else's corpus don't transfer); and **never infer difficulty from popularity** — the one study that
tried it got the sign backwards (easy recipes attract *more* engagement, ρ ≈ −0.4)
([Miyoshi et al. 2015](https://s3.amazonaws.com/aace-conf-media/conf/elearn/submission/uploads/elearn2015/paper_46393.pdf)).

---

# Evaluating the Founder's Two-Factor Hypothesis

The starting hypothesis: difficulty = **(1) ingredient rarity** + **(2) per-step technique
difficulty**. Held against the research:

**Factor 2 (per-step technique difficulty) is well-grounded — keep it.** It is exactly the mechanism
the two credible production systems use (a hand-built technique → difficulty table). It is the factor
most specific to *cooking skill* rather than mere size. We keep it, and make it the score's
skill-ceiling term.

**Factor 1 (ingredient rarity) is not a difficulty signal — replace it.** Three problems:

- **No precedent as difficulty.** Every source that scores ingredient rarity does so for
  substitution or similarity, never difficulty (Research §1). Folding it into difficulty invents an
  unvalidated construct.
- **It conflates sourcing with skill.** Saffron, gochujang, or sumac make a dish *hard to shop for*,
  not *hard to cook*. A one-pot saffron rice is a beginner recipe with a rare ingredient. Rarity
  would wrongly push it to advanced — a concrete failure mode the founder themselves flagged.
- **It needs reference data we'd have to build from a corpus** (an IDF table over thousands of
  ingredients) for a signal the research says shouldn't be in difficulty anyway.

**What the two-factor model *misses*: structural size and time.** Every credible formula (Müller &
Bergmann; Peterson) includes ingredient count, step count, and duration — and Peterson found *counts*
are the actual differentiator. The two-factor model has a second, symmetric failure mode:

> **A long recipe of trivial steps.** A 22-step sheet-pan dinner where every step is "chop" / "toss"
> / "roast" has *low per-step technique* but is genuinely more work than a 4-step one. With only
> technique as the non-rarity factor, the model scores it *easy*. Real cooks would not.

**Verdict.** Keep per-step technique. Drop ingredient rarity from the difficulty score (defer it as a
separate, optional *availability* signal — see Q-04). Add the structural terms the research validates:
**step count, ingredient count, total time.** The result is a four-factor additive score — the
founder's technique intuition, corrected and completed by the literature.

| Founder's factor | Verdict | This design |
|---|---|---|
| Per-step technique difficulty | ✅ Keep — matches both production systems | Factor **T** (skill ceiling) |
| Ingredient rarity | ❌ Drop from difficulty — no precedent, conflates sourcing with skill | Deferred as a separate availability signal (Q-04) |
| *(missing)* structural size | ➕ Add — the validated differentiator | Factors **S** (steps), **N** (ingredients) |
| *(missing)* time | ➕ Add — in every credible formula | Factor **M** (total minutes) |

---

# Recommended Method

## Per-step difficulty (the atomic unit)

Every step gets a **difficulty ∈ 1..5** — the weight of its *hardest* technique, from the seeded
`TECHNIQUE_DIFFICULTY` table (a step with no recognized technique gets the baseline `1`,
"combine/assemble"). This 1–5 value is the atomic signal, **persisted on the step row**
(`recipe_steps.difficulty`). Everything else is derived from it or from counts.

Storing the raw 1–5 weight — not a normalized 0–1 — keeps it at lowest granularity: it's the actual
technique-difficulty value, so the recipe rollup can be recomputed, re-capped, or re-weighted later
without re-scanning step text, and the "hardest step" is a plain `MAX()` over stored rows.

## The recipe score

A recipe's **raw difficulty** is the unweighted mean of the *available* normalized factors, scaled to
0–100:

```
raw = 100 × mean( T, S, N, [M if total_minutes is known] )
```

Each factor is normalized to [0,1] against a **cap** (values at or above the cap saturate at 1.0):

| Factor | Symbol | Source | Normalization |
|---|---|---|---|
| Technique ceiling | **T** | **peak** of the stored per-step difficulties (`max(recipe_steps.difficulty)`) | `peak / 5` (weights are 1–5) |
| Step count | **S** | count of `recipe_steps` | `min(steps, STEP_CAP) / STEP_CAP` |
| Ingredient count | **N** | count of `ingredients` | `min(ingredients, ING_CAP) / ING_CAP` |
| Total time | **M** | `recipes.total_minutes` | `min(minutes, TIME_CAP) / TIME_CAP`; **dropped** when null |

**Why unweighted.** Müller & Bergmann's validated formula is an unweighted sum; Peterson's weighted
one found the weights got swamped by his data anyway (Research §2). Starting unweighted means the only
things to tune are the four caps and the two band cutoffs — a small, legible knob-set. Per-factor
weights are a Phase-2 lever *if* calibration demands one (Q-03), not a launch complication.

**Technique — peak, not mean.** The recipe's **T** is the peak of the stored per-step difficulties.
Rationale: skill ceiling is set by the single hardest thing you must do — one tempering step makes a
recipe advanced no matter how many easy steps surround it. Using the *mean* per-step weight would let
a pile of trivial prep steps drown a lone hard technique (rejected — see Decisions). The "long recipe
of trivial steps" case is caught by **S**, not **T**, which is correct: it's *laborious*, not
*skilled*. Because every per-step value is now persisted, both peak *and* mean (and a "count of hard
steps" breadth term, Q-03) are derivable in SQL from the stored rows — so revisiting the aggregation
never means re-scanning step text.

**Graceful degradation (M).** `total_minutes` is nullable — many social imports have no time. When
it's absent we average the three factors we have rather than imputing a value. This mirrors the
pipeline's established "withhold, don't fabricate" posture (nutrition withholds macros it can't
compute; allergens persist `null` = undetermined, never a fabricated "absent").

## The bands

Three bands from two cutoffs on the raw score:

```
beginner      raw <  C50
intermediate  C50 ≤ raw < C85
advanced      raw ≥ C85
```

`C50`/`C85` are the **50th and 85th percentiles of the raw score across the real imported corpus**
(Peterson's approach — percentiles adapt to the recipes we actually have; fixed cutoffs tuned to a
baking-heavy thesis dataset would not transfer). They live in a small config constant, re-tunable
without touching the score. At cold start (no corpus yet) we seed provisional cutoffs from a labeled
sample (see Calibration); the first recalibration replaces them.

**Raw score and band are distinct concepts and stored separately.** The raw score is the continuous
source of truth; the band is a derived, re-bucketable presentation of it. Re-tuning cutoffs re-buckets
bands with no score recompute.

## Compute model: deterministic, no LLM

**Choice: pure deterministic scoring from a code-constant technique table + already-stored counts and
time.** No LLM call, no network, no DB read.

Justification (the ladder — simplest defensible option):

- **A learned model is off the table** — Research §1: no validated ground truth to train against.
- **An LLM classification (à la the taste step) buys nothing here and costs.** The taste step uses an
  LLM because cuisine is genuinely ambiguous from ingredients. Difficulty's inputs are *not* ambiguous
  — they're counts and a keyword scan over text we already have. An LLM would add latency, cost,
  non-determinism, and unauditability to reproduce a formula we can write in one pure function, and
  the research found no evidence an LLM beats the additive score. It also can't be *calibrated*: you
  can't move a band cutoff on an opaque model output.
- **Deterministic scoring is auditable, free, offline, and tunable.** Every recipe's score is a
  reproducible function of its stored data; re-running after a taxonomy or cap change is a local
  backfill with no API spend. This is the option the two credible production systems chose.

Technique detection reuses the codebase's existing **gazetteer pattern** (`RuleTagger`'s
`KEYWORD_DICT` in `server/src/categorize/`): a curated keyword → value map, scanned over lowercased
text, pure and table-driven. We are not inventing a mechanism — we're pointing an existing one at a
new table.

---

# Use Case Implementations

Work items use the difficulty-signal prefix **DIFF**. `F-DIFF-01` is the ingest-time flow; the
`O-DIFF-*` operations are its reusable internals.

## Score During Import — Implements F-DIFF-01: Attach Difficulty at Ingest

> **Implementation refinement (2026-08-17):** scoring runs at the **persist chokepoint**
> (`toRecipeInput`), not as a separate WDK step — see the "Compute at the persist chokepoint" decision
> below. The diagram's *logic* is unchanged (score → attach → persist); only the host moves. The
> load-bearing reason is per-step alignment: `toRecipeInput` strips bare section-label steps, so
> difficulty must be scored over the finalized step list. The build is specified in
> `docs/sprint-difficulty/specs/WI-DIFF-3-persist-integration.md`.

The scorer runs after `categorizeStep`'s enrichment is in hand and does **no external I/O** (no
`dbFromEnv()` read, no API) — its inputs are all on the in-memory recipe. Because it is pure, it lives
in the `toRecipeInput` mapping the persist transaction already calls, rather than a durable step whose
purpose is to checkpoint network work.

~~~mermaid
sequenceDiagram
    participant WF as importWorkflow
    participant DS as difficultyStep
    participant SC as DifficultyScorer
    participant TT as TECHNIQUE_DIFFICULTY
    participant PS as persistStep

    rect rgb(240, 248, 255)
    note over WF,DS: after categorizeStep, before persistStep
    WF->>DS: difficultyStep(recipes, input)
    end

    rect rgb(255, 248, 240)
    note over DS,TT: per recipe, best-effort (pure, no I/O)
    loop each recipe
        DS->>SC: score(steps, ingredients, totalMinutes)
        SC->>TT: per-step technique weights over step text (O-DIFF-01)
        TT-->>SC: weight ∈ 1..5 per step
        note over SC: T = max(step weights); T,S,N,[M] → raw 0..100 (O-DIFF-02)
        note over SC: raw → band via C50/C85 (O-DIFF-03)
        SC-->>DS: Difficulty{ score, band, stepDifficulties[] }
        note over DS: attach to ExtractedRecipeData; one calibration log line
    end
    end

    rect rgb(240, 255, 240)
    note over DS,PS: persist writes per-step + recipe-level difficulty
    DS-->>WF: enriched recipes
    WF->>PS: persistStep(recipes, input)
    note over PS: toRecipeInput folds in difficulty;<br/>persistWith writes recipe_steps.difficulty per step<br/>+ difficulty_score + difficulty_band on the recipe
    end
~~~

**Extension — scoring throws (E1).** `scoreOne` wraps `DifficultyScorer.score` in `try/catch`; on
error it logs `outcome=error` and returns the recipe with no `difficulty`. Persist writes `null` to
the two recipe columns and leaves each `recipe_steps.difficulty` null. The import still reaches
`ready`. (In practice a pure count-and-scan over resolved data has no failure path — the guard is
belt-and-suspenders parity with its sibling steps.)

**Extension — an empty recipe (E2).** Zero steps / zero ingredients → factors are 0 → raw 0 →
`beginner`. No special-casing; a contentless recipe *is* trivially "difficult." (A thin extraction
that under-detected steps is a garbage-in ceiling, surfaced by the calibration log, not hidden.)

## Score Each Step — O-DIFF-01: Lexicon Match Over Step Text

**The algorithm in one line: a step's difficulty is the weight of the hardest cooking technique named
in its text — a dictionary lookup, not inference.** There is no ML and no scoring model at the step
level; the "intelligence" lives entirely in the curated `TECHNIQUE_DIFFICULTY` table, and matching it
is a compiled string scan. This is deliberately the same high-precision gazetteer mechanism
`RuleTagger` already uses for cuisine keywords.

### The reference table

`TECHNIQUE_DIFFICULTY` is a code constant — an array of entries, each a technique, its **weight
(1–5)**, and the **surface forms** that signal it (inflections and synonyms listed explicitly, so no
stemmer or NLP dependency is needed):

```
{ canonical: "temper",     weight: 5, forms: ["temper", "tempered", "tempering"] }
{ canonical: "emulsify",   weight: 4, forms: ["emulsify", "emulsified", "emulsifying", "emulsion"] }
{ canonical: "bain-marie", weight: 5, forms: ["bain-marie", "bain marie", "water bath", "double boiler"] }
{ canonical: "sear",       weight: 3, forms: ["sear", "seared", "searing"] }
{ canonical: "sauté",      weight: 2, forms: ["sauté", "saute", "sautéed", "sautéing"] }
{ canonical: "chop",       weight: 2, forms: ["chop", "chopped", "chopping", "dice", "diced"] }
{ canonical: "boil",       weight: 1, forms: ["boil", "boiled", "boiling", "simmer", "simmered"] }
…  (~40–60 entries; Q-01 finalizes the list + weights)
```

The weight scale (illustrative; Q-01 sets the real values): **1** trivial (combine, boil, toss) · **2**
basic knife/pan work (chop, sauté) · **3** heat control / timing (sear, deglaze, reduce) · **4**
transformation with a failure mode (emulsify, caramelize, knead-and-proof) · **5** precision technique
(temper, laminate, bain-marie, confit).

### The matching procedure (per step)

At module load, all `forms` are compiled once into a single case-insensitive, word-boundary-anchored
alternation regex, longest-form-first, each form mapped to its technique's weight. Then per step:

1. **Normalize** the step text: lowercase, and collapse hyphens/whitespace so `sous-vide`, `sous vide`
   match the same form.
2. **Scan** with the compiled regex (`\b(form|form|…)\b`), collecting every match. `\b` boundaries
   stop false hits inside longer words — `\bsear\b` does not fire on "search", `\bscald\b` not on
   "scallion". Multi-word forms (`\bbain marie\b`) match as phrases.
3. **Resolve** each match to its weight and take **`max`** — a step is as hard as its hardest named
   technique.
4. **Baseline** when nothing matches: weight **1** ("combine/assemble"). A step with no recognized
   technique is not zero-difficulty; it's the floor.

The result (1–5) is the step's persisted difficulty. The recipe ceiling **T** is `max()` over the
per-step vector (O-DIFF-02). The operation returns the whole vector, not just the peak, so persist
writes each step and the recipe aggregate stays derivable.

~~~mermaid
sequenceDiagram
    participant SC as DifficultyScorer
    participant TM as TechniqueMatcher
    participant RX as compiled regex

    note over SC: step "Temper the chocolate over a bain-marie, stirring."
    SC->>TM: weight(text)
    TM->>RX: scan lowercased, hyphen-normalized text
    RX-->>TM: matches ["temper"→5, "bain marie"→5, "stir"→1]
    TM-->>SC: max = 5

    note over SC: step "Chop the onion and toss with oil."
    SC->>TM: weight(text)
    TM->>RX: scan
    RX-->>TM: matches ["chop"→2, "toss"→1]
    TM-->>SC: max = 2

    note over SC: step "Season and serve." (no technique)
    SC->>TM: weight(text)
    TM-->>SC: baseline 1

    note over SC: per-step vector [5, 2, 1] → T = max/5 = 1.0
~~~

### Precision over recall, on purpose

This is a **high-precision, moderate-recall** lexicon, and that asymmetry is intentional. Per the
data-transform-safety principle (`docs/harvest-principles.md`), the dangerous direction is a **false
positive** — wrongly flagging a simple recipe advanced. Word-boundary matching and curated forms guard
that hard. The accepted cost is **recall**: a paraphrase that never names the technique ("cook slowly
in a pan of simmering water" without "bain-marie"/"temper") is missed and the step falls to baseline.
That under-estimates, which is the safe direction, and recall is the calibration lever — adding a form
to the table is a one-line, no-migration change. Two known ceilings, accepted and logged, not hidden:
a technique mentioned but **negated** ("do *not* let it boil") still matches, and a technique named in
a non-instructional aside still counts. Neither is worth an NLP pass at this scale (Q-01/Q-07).

**Extension — no technique anywhere (E3).** All steps baseline → peak 1 → `T = 0.2`. A no-technique
recipe still gets a floor, not a zero (a recipe is at least "combine").

## Blend & Band — O-DIFF-02 / O-DIFF-03: Raw Score and Bucket

~~~mermaid
sequenceDiagram
    participant SC as DifficultyScorer
    participant CFG as DIFFICULTY_CONFIG

    note over SC: inputs — T=1.0, steps=6, ingredients=9, minutes=45
    SC->>CFG: caps {STEP_CAP, ING_CAP, TIME_CAP}
    CFG-->>SC: 15, 20, 120
    note over SC: S=6/15=0.40, N=9/20=0.45, M=45/120=0.375
    note over SC: raw = 100 × mean(1.0, 0.40, 0.45, 0.375) = 55.6

    SC->>CFG: cutoffs {C50, C85}
    CFG-->>SC: 38, 66
    note over SC: 38 ≤ 55.6 < 66 → band = intermediate
~~~

**Extension — missing time (E4).** `minutes = null` → `raw = 100 × mean(T, S, N)`; **M** omitted, not
zero-filled. The mean is over three terms, so a fast simple recipe with no listed time is not falsely
deflated by a phantom 0.

---

# Entities

`Step` gains a `difficulty` attribute (the atomic 1–5 signal). `Recipe` gains a `Difficulty` **value
object** — the continuous `score` and the derived `band` — that aggregates its steps' difficulties.
The technique taxonomy and the caps/cutoffs are **code constants**, not entities — small, versioned
with the code, no independent lifecycle (same reasoning the categorization doc applied to `VOCAB`).

~~~mermaid
classDiagram
    class Recipe {
        +string id
        +string title
        +int totalMinutes
        +List~Ingredient~ ingredients
        +List~Step~ steps
        +Difficulty difficulty
    }
    class Step {
        +int position
        +string text
        +int difficulty
    }
    class Difficulty {
        +number score
        +Band band
    }
    class Band {
        <<enumeration>>
        beginner
        intermediate
        advanced
    }
    Recipe "1" *-- "*" Step : steps
    Recipe "1" *-- "0..1" Difficulty : difficulty
    Difficulty --> Band
~~~

`Step.difficulty` is the stored atomic signal (1–5); `Recipe.difficulty` aggregates it. Both are
`0..1`/nullable: a recipe scored before this feature shipped, or one whose scoring errored (E1), has
neither. The recipe-level factor values (T/S/N/M) are **not** stored — `T` is `max(step.difficulty)`
and `S`/`N`/`M` are counts/columns already present, so the aggregate is a pure derivation of stored
data (T from the step rows, the rest from the recipe). Only the per-step difficulty and the recipe
`score`/`band` are persisted; the normalized factors appear in the calibration log line.

---

# Tables

## recipe_steps (existing — one column added)

Each step stores its own difficulty — the atomic signal. `recipe_steps` already exists
(`id, recipe_id, position, text`); this adds one column. No child table: difficulty is 1:1 with a
step and read back with it (the recipe rollup does `max()` over these rows).

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| difficulty | integer | nullable | the step's hardest-technique weight, 1–5 (baseline 1 = "combine"); `null` when the recipe wasn't scored |

Stored as the raw 1–5 weight (lowest granularity), not a normalized fraction — so the recipe
aggregate can be recomputed/re-weighted from these rows without re-scanning text. Not indexed: it's
read with its step, never filtered by value across rows.

## recipes (existing — two columns added)

The recipe rollup's primary consumer is the **ranking blend**, which reads one recipe's score
alongside its row (exactly like `nrf_score`), and **band filtering** ("show me beginner recipes").
This is a per-recipe scalar read back *with* the recipe — the opposite access pattern from
`recipe_categories` (which is filtered by value across rows and therefore normalized into a child
table). So the rollup belongs as columns on `recipes`, following the `nrf_score` precedent. (The
per-step atoms live on `recipe_steps` above; the recipe columns are their aggregate.)

| Column Name | Type | Constraints | Notes |
|---|---|---|---|
| difficulty_score | text | nullable | continuous 0–100 (pg/libSQL numeric→text, as `nrf_score`); the raw signal, source of truth |
| difficulty_band | text | nullable, enum('beginner','intermediate','advanced') | derived from `difficulty_score` via `C50`/`C85`; re-buckets on recalibration without a score recompute |

Both nullable: un-scored (pre-feature) and errored (E1) recipes carry `null`, read as "unknown"
(never a fabricated band). Free `text`/`enum` at the DB layer, constrained in application code —
matching the schema's posture for other controlled strings.

## Indices

| Name | Columns | Unique | Rationale |
|---|---|---|---|
| recipes_difficulty_band_idx | (difficulty_band) | no | serves "all beginner recipes" for ranking candidate generation / a difficulty filter |

Only the **band** is indexed — it's the categorical filter. The raw `difficulty_score` is read with
the row and blended, not filtered by exact value, so it needs no index (again mirroring `nrf_score`,
which is unindexed).

## TECHNIQUE_DIFFICULTY (code constant, **not** a table)

The technique → difficulty lookup is ~40–60 curated entries — each `{ canonical, weight 1–5, forms[] }`
(O-DIFF-01) — versioned with the code, validated in tests, never edited at runtime by a non-engineer
pre-launch, and never queried by users. By the exact Fermi-ROI reasoning the categorization doc used
for `VOCAB`/`KEYWORD_DICT`, it is a **code constant**, not a seeded DB table — a table would buy
runtime editability we don't need and cost a migration, a read, and a cache. Stored at lowest
granularity (per-technique weight + explicit surface forms), compiled once into the match regex, so
it's fully tunable in code. See Decisions.

---

# Modules

`DifficultyScorer` is a class with a `static create()` factory (repo convention), but it wires **no
collaborators** — its only dependency is the `TECHNIQUE_DIFFICULTY` and `DIFFICULTY_CONFIG` constants.
It is pure and synchronous.

~~~mermaid
classDiagram
    class DifficultyScorer {
        +score(steps, ingredients, totalMinutes) Difficulty
        +create() DifficultyScorer
    }
    class TechniqueMatcher {
        +stepWeights(steps) number[]
        -TECHNIQUE_DIFFICULTY
    }
    class DIFFICULTY_CONFIG {
        +STEP_CAP
        +ING_CAP
        +TIME_CAP
        +C50
        +C85
    }
    DifficultyScorer --> TechniqueMatcher : per-step weights
    DifficultyScorer --> DIFFICULTY_CONFIG : caps + cutoffs
~~~

~~~mermaid
flowchart LR
    A[difficultyStep] -->|steps, ingredients, minutes| B[DifficultyScorer]
    B -->|step texts| C[TechniqueMatcher]
    C -->|weight 1..5 per step| B
    B -->|Difficulty: stepDifficulties[] + score + band| A
    A -->|enriched recipe| D[persistStep]
    D -->|recipe_steps.difficulty + difficulty_score + difficulty_band| E[(libSQL)]
~~~

**New types.** `Difficulty = { score: number; band: 'beginner' | 'intermediate' | 'advanced';
stepDifficulties: number[] }` (the vector is index-aligned to `steps`), attached to
`ExtractedRecipeData` as a new optional `difficulty?` field — exactly as `estimate?` (nutrition) and
`categories?` were added — so it flows through `toRecipeInput` → `RecipeInput` → `persistWith` with no
change to the workflow's control flow.

**Persist seam.** `toRecipeInput` gains a `difficulty` passthrough. `RecipeRepository.persistWith`
already loops the steps to `insertSteps`; each step row now carries its `difficulty` (index-aligned,
no new insert call — one extra column in the existing insert), and the two recipe columns are written
in the same transaction. `findById` reads the per-step column back onto each step and the two recipe
columns into the `difficulty` object.

`TechniqueMatcher.stepWeights` is a pure function over the step texts and the `TECHNIQUE_DIFFICULTY`
constant — the `RuleTagger` gazetteer pattern, no I/O; it returns one weight per step.

---

# APIs

No new endpoints. Two fields are added to the recipe read models so a client (and later the ranking
engine's own reads) can see the signal. Contract-level addition only.

## Get Recipe `GET /v1/recipes/:id`

Existing endpoint; the response `recipe` object gains `difficulty`.

### Success Response `200`

- Headers
    - content-type: `application/json`
- Body
    - recipe: object
        - id: string
        - title: string
        - …existing fields…
        - difficulty: object | null
            - score: number  *(0–100, one decimal)*
            - band: string  *(`"beginner"` | `"intermediate"` | `"advanced"`)*

`difficulty` is `null` for un-scored recipes; otherwise both fields are present. The read model reads
the two `recipes` columns and composes the object at the boundary.

The library card (`RecipeCard`, `GET /v1/recipes`) gains **`difficulty_band`** only (not the raw
score) — a card shows the badge, not the number; the ranking reads the score server-side, never over
this API.

**Per-step difficulty is stored but not yet exposed on the API.** The recipe read model's `steps`
stay `string[]` for now — widening each step to `{ text, difficulty }` is a breaking contract change
worth making only when a consumer (e.g. a "hardest step" UI callout) needs it. The column is
populated from day one, so exposing it later is a read-model change with no backfill. See Q-06.

---

# Testing

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| O-DIFF-01: Per-step weights (gazetteer scan) | Op | x | | |
| O-DIFF-02: Blend to raw score (+ M-drop) | Op | x | | |
| O-DIFF-03: Band bucketing at cutoffs | Op | x | | |
| F-DIFF-01: Score during import | Flow | | x | |
| Persist difficulty (per-step + recipe columns) | — | x | | |

## Test Approach

### Unit Tests

- **`DifficultyScorer.score`** — table-driven over the worked examples: (a) a lone `temper` step →
  `T = 1.0` even amid trivial steps (peak, not mean), and `stepDifficulties` carries `5` at that
  step's index, `1` elsewhere; (b) the 22-step trivial sheet-pan recipe → low `T`, high `S` → lands
  `intermediate`, not `beginner` (the hypothesis failure mode we fixed); (c) `total_minutes = null` →
  mean over three factors, not four; (d) empty recipe → raw 0 → `beginner` (E2). Assert scores are
  stable, deterministic, and that `T == max(stepDifficulties)/5`.
- **`TechniqueMatcher.stepWeights`** — pure function: returns one weight per step, index-aligned;
  alias matching (`sous-vide` vs `sous vide`), word-boundary (`"scald"` must not fire on
  `"scallion"`), no-technique → baseline 1 (E3).
- **Band bucketing** — exact-boundary cases: `raw = C50` → `intermediate` (inclusive lower),
  `raw = C85` → `advanced`, `raw = C85 − ε` → `intermediate`.

The `TECHNIQUE_DIFFICULTY` and cap/cutoff constants stay **real** in tests (they're the thing under
calibration). Per `server/CLAUDE.md`, don't test the Zod parse or a stub returning its own constant.

### Integration Tests

- **`difficultyStep` in the import workflow** — mock the step's collaborators (unit-test the workflow
  by mocking steps; never test WDK replay). Assert the step runs after categorize, attaches
  `difficulty`, and that a thrown scorer yields an import that still reaches `ready` with `null`
  difficulty (E1).
- **Persist** — against the local libSQL test db (`tests/helpers/global-setup.ts`): persist a recipe
  with a `difficulty`, read it back via `findById`, assert the two recipe columns, the **per-step
  `recipe_steps.difficulty` values (index-aligned to the steps)**, and the `GET /v1/recipes/:id`
  shape. Assert `max(recipe_steps.difficulty)/5` equals the persisted `T` implied by the score. Assert
  the `difficulty_band` index serves a band filter, and replay idempotency (persist twice → same
  values, no error).

### End-to-End Tests

Covered by the existing import e2e (tests never hit the network — and difficulty needs no network
regardless): an imported fixture recipe emerges with a non-null `difficulty`. No new e2e harness.

## Test Infrastructure

None new. Reuse existing import fixtures. Add a tiny fixture recipe with a known hard technique
(`temper`) and one long-but-trivial recipe to lock the two headline behaviors.

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| 1 | schema | add `recipe_steps.difficulty`, `recipes.difficulty_score`, `recipes.difficulty_band` + `(difficulty_band)` index (`drizzle-kit generate` → `migrate`) | yes |

Additive only — three nullable columns across two tables, no drops (so no destructive+additive split
needed; see the codegen-non-interactive principle in `docs/harvest-principles.md`). Old code ignores
them; the migration runs before the code deploys with no coordination. No data migration: difficulty
applies to newly-imported recipes going forward.

## Deploy Sequence

Single deploy. Migration first (additive), then the code that writes the columns. Safe either way —
the columns are new and unread until the code ships.

## Backfill (deferred, optional)

Existing recipes stay un-scored until the ranking feature needs historical coverage. When it does, run
an **offline** one-shot that recomputes `DifficultyScorer` over stored `recipes` + `recipe_steps` +
`ingredients` and writes the per-step column plus the two recipe columns — no workflow, no network, no
API cost (the score is pure). Trivial and cheap; not built now — no consumer yet. **This same one-shot
is the recalibration tool** (see Calibration) — and because per-step weights are persisted, a
*re-cap/re-weight* recalibration reads `recipe_steps.difficulty` directly and never re-scans step
text; only a taxonomy change needs the full re-scan.

## Rollback Plan

Code rolls back independently of the migration: the three columns are inert without the writer, and
the read model tolerates their absence (`difficulty` defaults to `null`; steps stay `string[]`). If
the columns must go, drop them after the code rollback — nothing else references them.

---

# Monitoring

`difficultyStep` emits **one structured log line per recipe**, mirroring its sibling steps. The line
is the monitoring hook (no metrics framework), and it is also the **calibration dataset** — it carries
the four factor values so band cutoffs can be re-derived from real imports without re-running scoring.

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| difficulty_band_distribution | histogram | F-DIFF-01 | recipes per band; the signal's health — a bar stuck at one band means mis-calibrated caps/cutoffs |
| difficulty_outcome_total | counter | F-DIFF-01 | labelled `ok` / `error`; best-effort failure rate |

## Alerts

| Condition | Threshold | Severity |
|---|---|---|
| difficulty_band_distribution collapses to one band | >90% of 1h of imports in a single band | warn |
| difficulty_outcome error rate | >5% over 1h | warn |

Neither pages — difficulty is non-blocking enrichment; a regression degrades ranking quality, it does
not break import.

## Logging

One line per recipe at `info`, low-cardinality, carrying the raw score, band, and the four factors
(the calibration signal):
`[step] difficulty job=<id> title=<t> score=<n> band=<b> T=<n> S=<steps> N=<ings> M=<min|none> outcome=<ok|error>`.

---

# Calibration

The one part a minimal deterministic model **cannot** get right from first principles: whether the
band boundaries feel right on real Harvest recipes. The caps and cutoffs are the tuning knobs; here is
how they get set.

## Setting the caps (STEP_CAP, ING_CAP, TIME_CAP)

A cap saturates a factor's contribution — above it, more steps/ingredients/time don't add difficulty.
Set each to roughly the **85th–90th percentile** of that count across the imported corpus (so the top
decile saturates, the bulk spreads across [0,1]). Cold-start provisional values from the research and
common sense: `STEP_CAP = 15`, `ING_CAP = 20`, `TIME_CAP = 120` (min). Recompute from the corpus at
the first recalibration.

## Setting the band cutoffs (C50, C85)

Per Peterson: the **50th and 85th percentiles of the raw score across the corpus**. This makes the
bands relative to Harvest's actual mix — ~50% beginner, ~35% intermediate, ~15% advanced by
construction, then adjusted by the human check below. Cold-start provisional cutoffs from a labeled
sample; replace at first recalibration. Recalibration is the offline backfill (Deployment) re-run with
new cutoffs — pure recompute, no API cost.

## The human sanity check (do this before trusting the bands)

Because **no published weighting is validated** (Research §1), do not ship the bands untested. Run
Buykx's small-scale method: **20–30 imported recipes spanning the score range, rated
beginner/intermediate/advanced by a handful of people** (founder + a few cooks). Compare human labels
to the computed bands; if they disagree systematically, adjust caps first (a factor over/under-counts),
then cutoffs. This is cheap, one-time, and the only real validation the domain admits.

## Edge cases the model must survive

| Edge case | Naïve failure | This design |
|---|---|---|
| Simple recipe, one rare ingredient (saffron rice) | rarity factor → falsely advanced | **rarity excluded** → scored on technique/steps/time → correctly beginner |
| Long recipe of trivial steps (22-step sheet-pan) | technique-only → falsely beginner | high **S** lifts it to intermediate; **T** stays low (correct — laborious, not skilled) |
| One hard technique amid easy steps (temper) | mean-per-step → drowned → falsely easy | **peak** technique → `T = 1.0` → advanced |
| No `total_minutes` (social import) | phantom 0 deflates score | **M dropped**, mean over 3 factors |
| Thin extraction (under-detected steps) | silently under-scored | garbage-in ceiling, **visible** in the per-recipe log (factors printed), not hidden |
| Corpus is one cuisine/type (baking-heavy) | fixed cutoffs mis-band | **percentile** cutoffs adapt to the real mix |

## What "feels right" means

Success is not a number — it's that the founder, scrolling the library, agrees with the badges: the
weeknight pasta reads beginner, the laminated croissant reads advanced, and nothing is obviously
mislabeled. The band distribution metric (Monitoring) catches gross mis-calibration; the human check
catches the subtle kind.

---

# Decisions

## Drop ingredient rarity from the difficulty score; add structural + time factors

**Framework:** Direct criterion — the signal must model *cooking difficulty*, and rarity doesn't.

Ingredient rarity has no precedent as a difficulty signal (it only appears in substitution/similarity
work), and it conflates *hard to source* with *hard to cook* — a one-pot saffron rice would be falsely
flagged advanced (Research §4). Meanwhile the founder's two-factor model omits the structural size and
time that every credible formula includes and that Peterson found were the actual differentiators
(Research §2). So difficulty = technique ceiling + step count + ingredient count + time.

**Choice:** four-factor additive score (T, S, N, M); rarity deferred to a separate *availability*
signal if the product ever wants "hard to shop for" (Q-04).

### Alternatives Considered
- **Founder's rarity + technique:** rejected — rarity isn't difficulty; misses the validated
  structural factors; needs a corpus-derived IDF table for a signal that shouldn't be in the score.
- **Rarity kept but down-weighted:** rejected — a smaller wrong term is still a wrong term, and it
  drags in the reference-data cost. Cleaner to model availability as its own concept later.

### Documentation
- No standalone rarity-as-difficulty precedent: [arXiv 2302.07960](https://arxiv.org/pdf/2302.07960).
- Validated additive shape: [Müller & Bergmann 2017](https://ceur-ws.org/Vol-2028/paper26.pdf),
  [Peterson 2025](https://colepeterson.me/docs/Cole_T_Peterson_MSCS_Thesis.pdf).

## Deterministic scoring, not an LLM classification step

**Framework:** Fermi ROI — effort/cost vs. benefit.

An LLM difficulty step (mirroring the taste classifier) would cost per-recipe latency, API spend,
non-determinism, and unauditability — to reproduce a formula that is a pure count-and-scan over data
we already store. The research found no ground truth to train on (so no learned model) and no evidence
an LLM beats the additive score. A deterministic function is ~zero marginal cost, offline,
reproducible, and — decisively — **calibratable**: you can move a cutoff on a transparent score, not
on an opaque model output.

**Choice:** pure `DifficultyScorer` over a code-constant technique table + stored counts/time. No LLM,
no network, no DB read.

### Alternatives Considered
- **LLM classify (taste-step pattern):** rejected — cost + non-determinism + uncalibratable, for no
  accuracy evidence. The taste step earns its LLM because cuisine is ambiguous; difficulty's inputs
  aren't.
- **Learned regression/classifier:** rejected — no validated labeled data to train against
  (Research §1).

## `TECHNIQUE_DIFFICULTY` as a code constant, not a seeded DB table

**Framework:** Fermi ROI — effort vs. benefit; and consistency with the sibling design.

~40–60 curated technique→weight entries, versioned with the code, validated in tests, never
runtime-edited pre-launch, never user-queried. A DB table buys editability we don't need and costs a
migration, a per-score read, and a cache. The categorization doc made the identical call for
`VOCAB`/`KEYWORD_DICT`.

**Choice:** a `const TECHNIQUE_DIFFICULTY` (technique → weight 1–5, with aliases) in code, alongside
`DIFFICULTY_CONFIG` (caps + cutoffs). Stored at lowest granularity (per technique), fully tunable in
code; revisit a table only if non-engineers must edit weights live.

### Alternatives Considered
- **Seeded `technique_difficulty` table (FDC-catalog pattern):** rejected pre-launch — YAGNI; the
  taxonomy is small and code-versioned. The FDC pattern is for a 60 MB external catalog, not 50 rows.

## Store difficulty at two levels: per-step atom + recipe rollup

**Framework:** Direct criterion — store at the lowest useful granularity, then derive the aggregate.

The atomic signal is the per-step technique difficulty; the recipe score/band is a rollup of it.
Persisting only the rollup would throw away the atom (Jordan's store-at-lowest-granularity rule) and
force a step-text re-scan to ever re-aggregate. So store both:

- **Per-step atom** → `recipe_steps.difficulty` (1–5). It's 1:1 with a step, read *with* the step, so
  it's a column on the existing step row, not a new table. Not indexed (never filtered by value). This
  is the foundation: it makes "which step is hardest" a `MAX()`, and makes re-cap/re-weight
  recalibration read the stored atoms instead of re-scanning text.
- **Recipe rollup** → `difficulty_score` (unindexed, like `nrf_score`) + `difficulty_band` (indexed,
  the categorical filter) on `recipes`. This is the `nrf_score` access pattern — a per-recipe scalar
  read *with* the row plus a band filter — not the `recipe_categories` cross-row-value pattern, so it
  belongs on the row, not a child table.

**Choice:** `recipe_steps.difficulty` (the atom) + `recipes.difficulty_score`/`difficulty_band` (the
rollup); only the band is indexed.

### Alternatives Considered
- **Rollup only (recipe columns), recompute per-step on demand:** rejected — discards the atomic
  signal and forces a step-text re-scan for any re-aggregation; violates store-at-lowest-granularity.
- **A `recipe_difficulty` / `step_difficulty` child table:** rejected — difficulty is 1:1 with an
  existing row (step or recipe); a child table adds a join for no cross-row-value query.
- **Single column storing only the band:** rejected — the ranking needs the continuous score kept
  distinct from the band; a band-only column throws away the source of truth and blocks recalibration.

## Compute at the persist chokepoint (`toRecipeInput`), not a separate WDK step

**Framework:** Direct criterion — correctness (step alignment) + no I/O to checkpoint.

`toRecipeInput` strips bare section-label steps (`stripSectionLabels`) before persist, so per-step
difficulty must be scored over the **finalized** step list — otherwise the per-step values misalign
with the stored `recipe_steps` rows and `S` miscounts. `toRecipeInput` is the single point where steps
are final. Difficulty scoring also does no network/DB I/O, so — unlike the nutrition/allergen/categorize
steps, whose WDK-step status exists to checkpoint FDC reads — it gains nothing from being a durable
step. Scoring in the mapping the persist transaction already calls is both correct and a smaller diff
(no new workflow step, no `ExtractedRecipeData.difficulty` round-trip). The calibration log line moves
to the persist loop.

**Choice:** `DifficultyScorer.score(finalSteps, ingredientCount, totalMinutes)` invoked in
`toRecipeInput`; result attached to `RecipeInput`; repository writes the columns. Best-effort:
scoring wrapped so a failure persists null difficulty and never fails an import.

### Alternatives Considered
- **A best-effort `difficultyStep` before persist (original design):** rejected — scores pre-strip
  steps, so per-step values misalign with stored rows and `S` overcounts by the section-header count;
  adds a workflow step for pure CPU work that needs no checkpoint.
- **A `replaceSteps`-style recompute on every read:** rejected — wasted work; the score is stable
  once persisted.

## Step-difficulty algorithm: explicit-surface-form lexicon, not a stemmer or per-step LLM

**Framework:** Direct criterion — highest precision for the least machinery.

A step's difficulty is a max over technique matches (O-DIFF-01); the only real choice is *how* text
matches a technique. Three options: (a) list surface forms explicitly per technique and compile a
word-boundary regex; (b) a stemmer/lemmatizer to fold inflections automatically; (c) an LLM read per
step. For a ~50-entry hand table, (a) is the least machinery *and* the highest precision: the curator
writes the exact forms (`temper/tempered/tempering`), so there is no stemmer over-match
(`sear`→`search`), no dependency, and no `-ize`/`-ise` edge cases. Recall is bought back one form at a
time — the calibration lever.

**Choice:** explicit surface forms per technique, compiled once into a `\b`-anchored alternation regex;
match → weights → max, baseline 1.

### Alternatives Considered
- **Stemmer / lemmatizer (e.g. Porter):** rejected — a new dependency that *lowers* precision
  (aggressive stems over-match, `-ize` verbs mis-stem) to save curation we can do by hand in minutes.
- **Per-step LLM classification:** rejected — the whole-recipe version was already rejected (cost,
  non-determinism, uncalibratable); per-step multiplies the call count with no accuracy evidence.
- **Substring match without word boundaries:** rejected — false positives (`sear` in "search",
  `scald` in "scallion") are exactly the dangerous direction (§ data-transform safety).

## Technique factor = peak, not mean, per-step weight

**Framework:** Direct criterion — skill ceiling behavior.

A recipe is as skill-demanding as its hardest technique; a lone tempering step should read advanced
regardless of surrounding easy steps. The *mean* per-step weight dilutes a single hard technique among
many trivial prep steps — precisely the wrong behavior. Sustained labor (many steps) is captured by
the separate **S** factor, so **T** is free to model the ceiling.

**Choice:** `T = (max technique weight across all steps) / 5`.

### Alternatives Considered
- **Mean per-step weight (Müller & Bergmann's term):** rejected for *this* factor — dilutes the
  ceiling; the long-trivial-recipe load it would capture is already covered by **S**.
- **Peak + count of hard techniques:** deferred (Q-03) — more expressive but adds a factor; start
  with peak, add breadth only if calibration shows the ceiling alone mis-ranks.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Final `TECHNIQUE_DIFFICULTY` list + weights (1–5). Seed from Müller & Bergmann's WikiTaaable technique complexities + The Recipe Critic's tiering (basic → roux/laminated/tempering); needs a cooking-literate pass. | open | |
| Q-02 | Cold-start cap + cutoff values, pending the first corpus percentile computation. Provisional: STEP_CAP 15, ING_CAP 20, TIME_CAP 120; C50/C85 from a labeled sample. | open | |
| Q-03 | Is peak technique enough, or does **T** need a "breadth" term (count of distinct hard techniques)? Decide from the human calibration pass — add only if the ceiling alone mis-ranks. | open | |
| Q-04 | Ship an ingredient **availability** signal separately (IDF over the CC-BY-4.0 Ahn et al. 2011 corpus + a pantry-staple exclusion list)? Product call — not part of difficulty. | open | |
| Q-05 | Does the score need per-factor weights, or does unweighted + tuned caps suffice? Resolve empirically at calibration; start unweighted. | open | |
| Q-06 | Expose per-step `difficulty` on the recipe API (widen `steps` from `string[]` to `{ text, difficulty }`)? Deferred until a consumer (e.g. a "hardest step" UI callout) needs it; the column is populated from launch, so exposing later is a read-model-only change. | open | |
| Q-07 | Do the lexicon's known misses (paraphrased techniques → baseline; negated/aside mentions → counted) materially skew bands on real recipes? Measure at the calibration pass; the fix for a real skew is more surface forms (recall) or a tiny negation guard, not an NLP pass. | open | |

Q-01 and Q-02 gate the score's correctness at launch. Q-03/Q-05/Q-07 are calibration outcomes, not
launch blockers. Q-04 and Q-06 are separate follow-on features.

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-17 | Backend Tech Lead | Initial draft — deterministic four-factor additive score (technique-peak + steps + ingredients + time), percentile bands; ingredient rarity evaluated against the research and dropped from difficulty. Grounded in `docs/sprint-difficulty/research-report.md`. |
| 2026-08-17 | Backend Tech Lead | Store difficulty at two levels — per-step atom (`recipe_steps.difficulty`, 1–5) aggregated into the recipe rollup (`T = max(step difficulty)`). Adds the per-step column + migration, the `stepDifficulties[]` vector on `Difficulty`, the `Step.difficulty` entity attribute, and Q-06 (per-step API exposure, deferred). Follows store-at-lowest-granularity. |
| 2026-08-17 | Backend Tech Lead | Specified the step-difficulty **algorithm** (O-DIFF-01): the `TECHNIQUE_DIFFICULTY` entry shape (`{ canonical, weight, forms[] }`), the compiled `\b`-anchored regex match → weights → max → baseline-1 procedure, a worked trace, and the precision-over-recall posture. Added the matching-approach decision (explicit surface forms, not a stemmer/LLM) and Q-07 (lexicon-miss skew). |
| 2026-08-17 | Backend Tech Lead | Build refinement: score at the persist chokepoint (`toRecipeInput`) instead of a separate `difficultyStep`, for per-step/step-strip alignment correctness (scoring does no I/O, so no durable step is warranted). Added the decision; broke the feature into `docs/sprint-difficulty/specs/WI-DIFF-1..4`. |
