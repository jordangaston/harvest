# WI-1 — Evolve `user_food_prefs` into a scoped directive

## Background

`docs/food-preference-model-design.md` replaces the taste facets, food-category moderation, and
the per-user weight vector with one scoped **directive**:
`{ dimension, value, scope, direction, strength, target?, unit? }`. The directive lives on the
existing `user_food_prefs` table, evolved in place — no new table (pre-release).

Today the table is:

```
user_food_prefs(
  user_id text not null → users,
  facet   text not null,   -- enum AFFINITY_FACETS: cuisine|dish_type|primary_ingredient|ingredient|food_category
  value   text not null,
  sentiment text null,     -- enum SENTIMENTS: like|dislike (taste axis, nullable)
  target    real null,     -- intent axis −1..+1
  reason    text null,
  primary key (user_id, facet, value)
)
```

Readers of these columns today: `PreferenceRepository` (read + `addDislike`/`upsertFoodPref`/
`savePreferences`), the ranking `AffinityScorer` (`f.sentiment`), the `RankingEngine` food-category
moderation (`f.facet === 'food_category' && f.target < 0`), the taste-space `TasteRepository`/
`AnchorResolver` (`sentiment === 'dislike'`), the chef `FoodPreferenceType`, `preferences-dto.ts`,
and the `FoodPref` Zod model.

This is the foundational slice: it reshapes the table and every reader without changing ranking or
chef behavior. WI-2 (fact types), WI-3 (ranking), WI-4 (plate model) build on the new columns.

### Decomposition deviation from the design (flagged)

The design lists two things under WI-1 that this spec **defers to WI-3**:

- **Dropping `user_preferences.weight_*` columns.** Seven columns
  (`weight_cost/time/nutrition/difficulty/affinity/popularity/meal_prep`) feed the ranking
  `SignalScorer.weight()` and are snapshotted into `recipe_swipes.weights` by the swipe flow.
  Dropping them requires rewriting the ranker's weighting model and the swipe snapshot — that IS
  WI-3. Removing them in WI-1 while WI-3 is deferred breaks ranking and swipe, which WI-1 may not
  touch. So `strength` is *added* here (default `soft`); the weight columns retire in WI-3 alongside
  their replacement. This keeps WI-1 self-contained and every test green.

Everything else the design assigns to WI-1 is in scope: the new columns, the widened `dimension`
enum, the migration of existing rows, the Zod model, and the repository read/write.

## Objective

Evolve `user_food_prefs` to the directive shape and route every current reader through the new
columns, preserving today's ranking and chef behavior exactly.

## Scope

1. **Schema** (`server/src/schema.ts`):
   - Rename `facet` → `dimension`; widen its enum to `DIRECTIVE_DIMENSIONS =
     [cuisine, dish_type, primary_ingredient, ingredient, food_category, nutrient]` (adds
     `nutrient`; keeps the existing five so no value re-maps).
   - Replace `sentiment` with `direction text not null` (enum `DIRECTIONS = [more, less]`).
   - Add `scope text not null default 'recipe'` (enum `DIRECTIVE_SCOPES =
     [recipe, breakfast, lunch, dinner, snack, day, week]`).
   - Add `strength text not null default 'soft'` (enum `STRENGTHS = [soft, firm, strict]`).
   - Add `unit text null` (free string; the nutrient/count unit, aggregate scopes only).
   - Keep `target real null` and `reason text null`.
   - Primary key becomes `(user_id, dimension, value, scope)` (design § Tables; scope joins the key
     so the same value can carry a recipe-scope taste and an aggregate-scope budget).

2. **Migration** (`drizzle-kit generate`): the generated SQL plus a hand-added data backfill that
   maps every existing row before the old columns go away:
   - `dimension` ← `facet`.
   - `scope` ← `'recipe'`.
   - `strength` ← `'soft'`.
   - `direction` ← `'less'` when `sentiment = 'dislike'` OR `target < 0`; else `'more'`
     (a `like`, a positive/zero target, or a pure-intent row all read as `more`). Every legacy row
     has a non-null `sentiment` or `target` (the ≥1-axis invariant), so `direction` is always
     derivable.
   - `target`, `reason` carry over unchanged; `unit` stays null.

3. **Zod model** (`server/src/models/user-preferences.ts`): rename `FoodPref`/`FoodPrefUpdate` to
   the directive shape — `dimension`, `value`, `direction`, `strength`, `scope`, `target`, `unit`,
   `reason`. Drop the `sentiment` field and the ≥1-axis refine (a directive always has a
   `direction`, so it always carries signal). `strength`/`scope` default in the parse.

4. **Repository** (`server/src/repositories/preference-repository.ts`): route `getPreferences`,
   `addDislike`, `upsertFoodPref`, and `savePreferences` through the new columns. `addDislike`
   writes `direction='less', strength='soft', scope='recipe'`. The `primary_ingredient`-is-
   server-owned guard and the "keep the loop's rows on a settings save" delete predicate move from
   `facet` to `dimension`.

5. **Behavior-preserving reader maps** (no semantic change):
   - `AffinityScorer` (`server/src/ranking/scorers.ts`): `f.sentiment === 'like'/'dislike'` →
     `f.direction === 'more'/'less'` on taste dimensions.
   - `RankingEngine` moderation: `f.facet` → `f.dimension`.
   - `TasteRepository.userFoodPrefs` + `AnchorResolver`: select `direction` not `sentiment`;
     `direction === 'less'` is the repulsor (was `sentiment === 'dislike'`).
   - `preferences-dto.ts`: the wire DTO carries `dimension`/`direction`/`strength`/`scope`/`unit`
     in place of `facet`/`sentiment`.
   - The chef `FoodPreferenceType` (`server/src/chef/facts/fact-types.ts`): its `upsertFoodPref`
     call and `read` map `facet`→`dimension`, `sentiment`→`direction` (like→more, dislike→less).
     The fact's external value shape (`{facet, sentiment, target}`) is unchanged here — WI-2 owns
     the `set_directive` tool and the composite value; this spec only keeps the existing fact
     writing correctly against the new table.

## Acceptance Criteria

- **AC-1** The migration adds `scope`, `direction`, `strength`, `unit`, renames `facet`→`dimension`,
  widens the dimension enum with `nutrient`, and changes the PK to `(user_id, dimension, value,
  scope)`. The full test suite migrates a real libSQL file DB, exercising the migration.
- **AC-2** A legacy row with `sentiment='like'` migrates to `direction='more', scope='recipe',
  strength='soft'`, `target`/`reason` preserved.
- **AC-3** A legacy row with `sentiment='dislike'` (or `target < 0`) migrates to `direction='less'`.
- **AC-4** `PreferenceRepository.getPreferences` returns directives with the new fields;
  `upsertFoodPref` and `savePreferences` round-trip `dimension`/`direction`/`strength`/`target`/
  `reason` and default `scope='recipe'`, `strength='soft'`.
- **AC-5** `addDislike` writes a `direction='less'` recipe-scope directive and still flips an
  existing directive at the same `(dimension, value, scope)`; the `primary_ingredient` server-owned
  rows survive a settings save.
- **AC-6** Ranking and chef behavior are unchanged: the affinity like/dislike bite, the
  food-category moderation penalty, and the taste-space repulsors produce identical rankings for the
  same stated preferences (existing `ranked-recipes`, `taste-space`, `facts` tests pass, mapped to
  the new columns).
- **AC-7** `pnpm exec tsc --noEmit` is clean; `pnpm exec vitest run` is green except the two
  pre-existing `test/media.test.ts` ffmpeg-static failures.

## Test Cases

### Test Case 1: migration reshapes the table and backfills direction (AC-1/2/3)

**Preconditions:** a fresh libSQL file DB, migrated by the suite's migrator; foreign-key
enforcement off (as `migrator.test.ts` does) so a bare `user_food_prefs` row needs no `users` row.

**Steps:** seed pre-migration rows via raw SQL on a DB migrated to the commit before this one — one
`sentiment='like'`, one `sentiment='dislike'`, one pure-intent (`target=-0.9`, null sentiment). Run
the new migration. Select `dimension, direction, scope, strength, target, reason`.

**Expected Outcomes:** the `like` row → `direction='more'`; the `dislike` and the `target<0` rows →
`direction='less'`; all → `scope='recipe', strength='soft'`; `target`/`reason` unchanged; no `facet`
or `sentiment` column remains.

### Test Case 2: repository round-trips a directive (AC-4)

**Preconditions:** a migrated DB and a real user.

**Steps:** `upsertFoodPref(user, { dimension:'cuisine', value:'thai', direction:'more' })`; read via
`getPreferences`.

**Expected Outcomes:** one directive `{ dimension:'cuisine', value:'thai', direction:'more',
strength:'soft', scope:'recipe', target:null, unit:null, reason:null }`.

### Test Case 3: addDislike + settings-save slice isolation (AC-5)

**Preconditions:** a migrated DB and a real user.

**Steps:** `addDislike(user, 'primary_ingredient', 'liver')`; then `savePreferences` with one
`cuisine`/`more` directive.

**Expected Outcomes:** after the save, the `cuisine` directive is present, and the
`primary_ingredient`/`liver`/`less` directive the loop wrote survives untouched.

### Test Case 4: ranking behavior is preserved (AC-6)

**Preconditions:** the existing `ranked-recipes` worked example, its food prefs re-expressed as
directives (`like`→`more`, `dislike`→`less`, moderation as a `food_category`/`less`/`target` row).

**Steps:** run the ranker; compare the ordered result to the pre-change expectation.

**Expected Outcomes:** identical ranking — the affinity bite and moderation penalty are unchanged.

## Test Run

_(filled during implementation)_

## Deployment Strategy

A single Drizzle migration applied by `drizzle-kit migrate` in journal order to libSQL/Turso. The
backfill runs inside the same migration, so the old columns drop only after every row carries the
new ones. Pre-release: no production data at risk; the migration is forward-only.

## Production Verification

### Production Verification 1: directive round-trip through the chef

**Preconditions:** the migrated server; a member subject.

**Steps:** the chef writes a `FOOD_PREFERENCE` (`{facet:'cuisine', value:'thai', sentiment:'like'}`);
read the member's preferences.

**Expected Outcomes:** a `cuisine`/`thai`/`more` directive at `scope='recipe'`, `strength='soft'`.

## Production Verification Run

_(filled after deploy)_
