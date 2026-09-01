# Soft, degreed food-moderation preference ("eat less of X")

## Background

A user told the chef "I'm trying to limit red meat." Today Harvest has no way to model that.
The preference model (`server/src/models/user-preferences.ts`) offers three shapes, none of which fit:

- **Allergens** (`user_allergens`) and **diets** (`user_diets`) are exclusions. `red_meat_free` exists
  (`server/src/diet/diet-rules.ts:43`) and its `flexible` strictness applies a flat −0.2 penalty
  (`server/src/ranking/ranking-engine.ts:54`, `constants.ts`) — soft, but **binary**: no "a little less"
  vs "a lot less", and no positive side ("more fish").
- **Taste prefs** (`user_food_prefs`, facet ∈ {cuisine, dish_type, primary_ingredient, ingredient},
  sentiment ∈ {like, dislike}) are **taste**, and binary. They conflate two different things: a user can
  *like* steak and still want *less* of it. Encoding that as a `dislike` lies about the taste and corrupts
  what a model can infer.

The constraint is **soft and degreed**, and taste is **orthogonal** to intent. "I like steak but want less
for my health" is three facts: taste = like, intent = eat less, reason = health. The model must carry all
three without faking any.

Relevant system context:

- **Recipe food classes already exist but are discarded.** `DietClassifier.classify()` runs at ingest
  (`server/src/workflows/import-workflow.ts:432` `dietStep`) and classifies **every** ingredient's food
  class name-first (`server/src/diet/food-class-map.ts`, 12 `FOOD_CLASSES` incl. `red_meat`). It keeps only
  the per-diet verdict + first blocker; the per-ingredient class set is computed and thrown away.
- **Recipe facets are a normalized child table.** `recipe_categories(recipeId, facet, value)`
  (`schema.ts:325`); `facet` is the `FACETS` enum (`schema.ts:23`), `value` is free text (no value
  migration to add `red_meat`).
- **Ranking already joins prefs ⋈ recipe facets.** `AffinityScorer` (`server/src/ranking/scorers.ts:51`)
  scores `user_food_prefs` against `recipe.categories`; `ranking-engine.ts` `penalty()` already subtracts
  for flexible-diet / mild-allergen. We extend these, not replace them.

**Design decision (settled with the founder):** keep every user preference in `user_food_prefs`, add a
`food_category` facet to both the recipe and user sides, and split the preference into **two orthogonal
axes** on the row — `sentiment` (taste) and a new `target` (intent, degreed) — plus a `reason` blurb. Taste
feeds `AffinityScorer` unchanged; intent feeds a separate moderation down-weight so a moderated recipe sinks
because the user is moderating it, **not** because they dislike it.

Rejected alternative: a `food_categories` array on `fdc_foods`. The authoritative class signal is the
ingredient **name** (FDC categories mislabel butter/ghee as "Fats and oils", not dairy — see
`food-class-map.ts:1`), and `ingredients.fdc_id` is nullable, so an FDC-only tag is both wrong and
incomplete. The recipe already gets classified name-first at ingest; persist that. (server/CLAUDE.md: don't
build a projection before something reads it.)

## Objective

Let a user express a soft, degreed "eat more/less of a food class" preference (first case: limit red meat),
set via the chef or settings, stored honestly alongside taste and rationale in `user_food_prefs`, and
honored by the ranker so moderated food classes rank lower without being excluded and without faking a
dislike.

## Scope

**In scope**

1. Persist a recipe's food classes as `recipe_categories` rows (`facet = 'food_category'`), sourced from the
   classification `DietClassifier` already runs at ingest, plus a one-off backfill of the existing corpus.
2. Add two axes + rationale to `user_food_prefs`: make `sentiment` nullable, add `target` (−1..+1) and
   `reason`; add `food_category` to the user-side facet enum.
3. Unify the `/v1/preferences` DTO (GET + PUT): replace `likes`/`dislikes` with one `foodPrefs` array that
   carries `facet, value, sentiment?, target?, reason?`, matching the resolved model. Update the server
   schema, client `ApiPreferences`, and `preferences-map.ts` together.
3. A moderation down-weight in ranking driven by negative `target` on a food class the recipe carries.
4. Chef capture: `save_member_profile` writes the food-class moderation (target + optional taste + reason);
   `search_catalog` grounds a food class.
5. Settings surface: an "eat more / less of…" control.

**Out of scope**

- The **positive** side ("more fish") in ranking. `target > 0` is stored and shown, but the ranking effect
  ships as a *penalty* (subtract-only), which handles "less" only. A signed `ModerationScorer` for "more"
  is a follow-up. [ASSUMPTION: the founder's ask is "less"; positive ranking is deferred, not dropped.]
- New food classes. Reuse the existing 12 `FOOD_CLASSES`.
- Meal-plan generation (there is none — swipe deck + manual slots).

## Design

### Data model

`user_food_prefs` (`schema.ts:676`) — additive, one migration:

```ts
export const userFoodPrefs = sqliteTable('user_food_prefs', {
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  facet:     text('facet', { enum: AFFINITY_FACETS }).notNull(),   // + 'food_category'
  value:     text('value').notNull(),
  sentiment: text('sentiment', { enum: SENTIMENTS }),              // CHANGED: now nullable (taste)
  target:    real('target'),                                        // NEW: intent, -1 less … +1 more
  reason:    text('reason'),                                        // NEW: LLM "why" blurb
}, (t) => [primaryKey({ columns: [t.userId, t.facet, t.value] })]);
```

Enums:
- `AFFINITY_FACETS` (`schema.ts:68` **and** `models/user-preferences.ts:10`) += `'food_category'`.
- `FACETS` (`schema.ts:23`, recipe side) += `'food_category'`.

Invariant: a row carries at least one of `sentiment` / `target` (enforce in the Zod model + repo, not the DB).

Steak example row: `(userId, 'food_category', 'red_meat', sentiment='like', target=-0.6, reason='heart health')`.

Domain model (`models/user-preferences.ts`): `foodPrefs` item becomes
`{ facet, value, sentiment: z.enum(SENTIMENTS).nullable(), target: z.number().min(-1).max(1).nullable(), reason: z.string().nullable() }`.
**API — one unified array.** `PreferencesUpdateSchema` **replaces** the separate `likes`/`dislikes` arrays
with a single

```ts
foodPrefs: z.array(z.object({
  facet:     z.enum(AFFINITY_FACETS),          // incl. 'food_category'
  value:     z.string(),
  sentiment: z.enum(SENTIMENTS).nullish(),     // taste
  target:    z.number().min(-1).max(1).nullish(), // intent
  reason:    z.string().nullish(),
}))
```

that mirrors the `user_food_prefs` row 1:1. GET and PUT both use it (the resolved `UserPreferences.foodPrefs`
already has this shape, so the editable subset and the read model finally agree). Each element carries
whichever axes apply: a taste like = `{facet:'cuisine', value:'thai', sentiment:'like'}`; a moderation =
`{facet:'food_category', value:'red_meat', target:-0.6}`; the steak case = both on one element. The repo
upserts each element into `user_food_prefs` keyed by `(userId, facet, value)` through **one write routine**;
an element with neither `sentiment` nor `target` is rejected. This is a breaking DTO change and that's fine:
monorepo, pre-launch, no pinned client — the server schema, client `ApiPreferences` (`lib/api/preferences.ts`),
and `preferences-map.ts` change in the same PR. The `SettingsScreen` UI derives its like/dislike chip groups
and the eat-more/less controls from the one array by facet/sentiment/target. `weights.affinity` (0–3,
server-owned) is untouched — do **not** name any field `weight`.

### Ingest — tag recipes with their food classes

`DietClassifier` (`server/src/diet/diet-classifier.ts`) already computes `ClassifiedIngredient[]` with
`cls: FoodClass | null`. Expose the deduped union of non-null `cls` (e.g. return `foodClasses: FoodClass[]`
on `DietCompat`, or a sibling method). In `classifyOneDiet` (`import-workflow.ts:444`) attach it to the
recipe; persist via `insertCategories` (`recipe-repository.ts:252`) by adding a `foodCategory: string[]` key
to `RecipeCategories` + `FACET_BY_KEY.foodCategory = 'food_category'`. `onConflictDoNothing` keeps replay
idempotent. Best-effort, same as the existing steps: a classifier failure leaves the recipe untagged, never
fails the import.

**Backfill:** a one-off script (`scripts/`) re-runs classification over existing recipes and inserts the
`food_category` rows, so the live corpus is moderatable on day one. Without it, only newly-imported recipes
are tagged and moderation silently under-applies (log the counts; see harvest-principles "no silent caps").

### Ranking

`RankableRecipe.categories` (`server/src/ranking/types.ts`) gains `foodCategory: string[]`; hydrate it in
`recipe-repository.ts` alongside the other facets (`listDeckCandidates` / `assembleRankable`,
batched query already reads `recipe_categories`).

Moderation down-weight in `ranking-engine.ts` `penalty()` (`:54`):

```ts
for (const p of prefs.foodPrefs) {
  if (p.facet === 'food_category' && p.target != null && p.target < 0
      && recipe.categories.foodCategory.includes(p.value)) {
    total += MODERATION_WEIGHT * (-p.target);   // e.g. MODERATION_WEIGHT = 0.3 in constants.ts
  }
}
```

`AffinityScorer` (`scorers.ts:51`): `facetSentiment` must **skip rows with `sentiment == null`** (a
pure-intent row contributes no taste). A `food_category` row *with* `sentiment='like'` correctly raises
affinity — taste and intent both honored, in opposite directions, from one row.

`MODERATION_WEIGHT` is a tuning knob — validate against the real corpus that a `target=-0.6` red-meat pref
visibly reorders the deck (a red-meat recipe ranks below an otherwise-equivalent non-red-meat one). Settle
the number by running the ranker on live data, not by eyeball (harvest-principles: verify against live reality).

### Chef

- `search_catalog` (`server/src/chef/tools/search-catalog.ts`): add `kind: 'food_category'` returning the 12
  `FOOD_CLASSES` as `{value,label}`, ranked by the same catalog matcher (floor 0.6) so "red meat" → `red_meat`.
- `save_member_profile` (`server/src/chef/tools/save-member-profile.ts`): accept a moderation on a grounded
  food class — `target` (map NL degree: "trying to limit" ≈ −0.5, "cut way back" ≈ −0.9), optional
  `sentiment` when the user states taste ("I love steak"), and `reason` when given. Write through
  `PreferenceRepository`. Unmatched food-class values are rejected with nearest matches, like every other
  catalog write.
- The chef confirms without nagging: "Got it — I'll ease off red meat. Still a steak now and then, just less
  often." It must not claim the user dislikes it.

### Settings

An "Eat more / less of…" section in the existing preferences editor **`components/swipe/SettingsScreen.tsx`**
(rendered via `app/(app)/discover.tsx`), listing food classes with a degreed control. Reuse the `Segmented`
component already used there for skill level / allergen severity / diet strictness — five stops (−− − 0 + ++)
→ `target` — with the segmented-active `bg-brand` styling (AGENTS.md). Onboarding capture (if wanted) mirrors
it in `app/(onboarding)/flow.tsx`. Writes go through the unified `foodPrefs` array via `useUpdatePreferences`
(`lib/api/hooks.ts`), which already invalidates `preferences` + `deck`. `ApiPreferences` and
`preferences-map.ts` replace `likes`/`dislikes` with `foodPrefs`; `SettingsScreen` derives its like/dislike
chip lists (filter `sentiment`) and the eat-more/less controls (read `target`) from that one array.

## Acceptance Criteria

1. **Recipe tagging.** Given a recipe whose ingredients include beef, when it is imported, then
   `recipe_categories` has a row `(recipeId, 'food_category', 'red_meat')`. Given a recipe with no red-meat
   ingredient, then it has no `food_category='red_meat'` row.
2. **Backfill.** Given recipes imported before this change, when the backfill script runs, then each is
   tagged with its food classes and the script logs how many recipes and rows it wrote.
3. **Two-axis storage.** Given a write of `(food_category, red_meat, sentiment=like, target=-0.6,
   reason='heart health')`, when the preference is read back, then all four fields round-trip and
   `sentiment` remains `like`.
4. **Nullable sentiment.** Given a pure-intent write `(food_category, red_meat, target=-0.9)` with no
   sentiment, when persisted and read, then `sentiment` is null and no default like/dislike is invented.
5. **Moderation down-weight.** Given a user with `(food_category, red_meat, target=-0.6)`, when the deck is
   ranked, then a red-meat recipe's score is reduced by `MODERATION_WEIGHT*0.6` versus the same recipe for a
   user without the pref, and no red-meat recipe is excluded.
6. **Taste not faked.** Given `(food_category, red_meat, sentiment=like, target=-0.6)`, when ranking, then
   the affinity signal treats red meat as liked (no affinity penalty) while the moderation down-weight still
   applies. A model reading the row sees "likes red meat, wants less, for heart health."
7. **Positive target is inert in ranking (this milestone).** Given `(food_category, seafood, target=+0.8)`,
   when ranking, then no penalty is applied and the score is unchanged (stored + displayable, not yet boosted).
8. **Chef capture.** Given a user texts "I love a good steak but I'm trying to cut back on red meat for my
   heart", when the chef turn completes, then `save_member_profile` has written a `food_category`/`red_meat`
   row with `target < 0`, `sentiment='like'`, and a `reason` mentioning heart/health, and the chef's reply
   acknowledges eating less without claiming dislike.
9. **Grounding.** Given `search_catalog(kind='food_category', query='red meat')`, then `red_meat` is the top
   candidate; given `query=''`, then all 12 food classes are returned.
10. **Migration is non-interactive & additive.** Given a clean checkout, when `drizzle-kit generate` runs,
    then it produces one migration with no interactive prompt, and existing `user_food_prefs` rows keep
    their `sentiment` with `target`/`reason` null.
11. **Unified DTO round-trip.** Given a PUT of `foodPrefs` mixing a taste like, a pure moderation, and a
    combined taste+intent element, when read back via GET, then the same single `foodPrefs` array returns
    with every element's axes intact, and the response contains no `likes`/`dislikes` keys.

## Test Cases

### Test Case 1: DietClassifier surfaces the food-class union (AC 1)
**Preconditions:** offline FDC stub; a recipe with ingredients ["ground beef", "onion", "olive oil"].
**Steps:** call the classifier; assert the exposed `foodClasses`.
**Expected Outcomes:** `foodClasses` contains `red_meat` and `vegetable` (and/or `fat_oil`), deduped;
a beef-free recipe yields no `red_meat`; an all-unrecognized recipe yields `[]`.

### Test Case 2: Ingest persists food_category rows (AC 1)
**Preconditions:** integration DB; import pipeline with offline stubs.
**Steps:** import a beef recipe; query `recipe_categories`.
**Expected Outcomes:** a `(recipeId,'food_category','red_meat')` row exists; re-running the step inserts no
duplicate (`onConflictDoNothing`).

### Test Case 3: Backfill script (AC 2)
**Preconditions:** integration DB seeded with 3 pre-existing recipes (2 with red meat), none tagged.
**Steps:** run the backfill script.
**Expected Outcomes:** the 2 red-meat recipes gain `food_category='red_meat'` rows; the script logs
`recipes=3 rows_written=N`; a second run is idempotent.

### Test Case 4: Preference round-trip, both axes + reason (AC 3, AC 4)
**Preconditions:** integration DB; a user.
**Steps:** save `(food_category, red_meat, sentiment=like, target=-0.6, reason='heart health')`; read it.
Then save `(food_category, red_meat, target=-0.9)` (no sentiment) for a second user; read it.
**Expected Outcomes:** first round-trips all four fields; second reads `sentiment=null`, `target=-0.9`,
`reason=null`. Repo rejects a row with neither sentiment nor target.

### Test Case 5: Moderation penalty applied and bounded (AC 5, AC 7)
**Preconditions:** unit test of `RankingEngine`; two `RankableRecipe`s identical except one has
`categories.foodCategory=['red_meat']`; `MODERATION_WEIGHT` known.
**Steps:** rank for a user with `target=-0.6` on `red_meat`; rank the same for a user with no pref; rank for
a user with `target=+0.8` on `seafood` (recipes carry no seafood).
**Expected Outcomes:** red-meat recipe's score drops by `MODERATION_WEIGHT*0.6` vs the no-pref user; the
non-red-meat recipe is unchanged; neither recipe is filtered out; the `target=+0.8` case changes nothing.

### Test Case 6: Taste preserved while moderating (AC 6)
**Preconditions:** unit test; a red-meat recipe; user pref `(food_category, red_meat, sentiment=like,
target=-0.6)`.
**Steps:** score the recipe; inspect the affinity breakdown and the penalty.
**Expected Outcomes:** affinity treats `red_meat` as liked (contributes ≥ neutral, no dislike); the
moderation penalty still subtracts. A pure-intent row (`sentiment=null`) contributes nothing to affinity.

### Test Case 7: Chef writes the moderation from natural language (AC 8, AC 9)
**Preconditions:** chef reasoning test harness with offline model stub; an onboarded member.
**Steps:** feed "I love a good steak but I'm cutting back on red meat for my heart"; run the turn.
**Expected Outcomes:** `save_member_profile` persists `(food_category, red_meat, sentiment=like, target<0,
reason~/heart|health/)`; `search_catalog(kind='food_category')` grounds "red meat"→`red_meat`; the reply
acknowledges "less/occasional" and never says the user dislikes steak.

### Test Case 8: PUT/GET preferences + deck re-rank (AC 5, AC 10)
**Preconditions:** integration; a user with a red-meat and a non-red-meat recipe visible.
**Steps:** `PUT /v1/preferences` with the red-meat moderation; `GET /v1/preferences`; fetch the ranked deck.
**Expected Outcomes:** GET echoes target+reason+sentiment; in the deck the red-meat recipe ranks below the
comparable non-red-meat recipe; the mutation invalidated `deck`.

### Test Case 9: Migration is additive & non-interactive (AC 10)
**Preconditions:** clean checkout with a seeded `user_food_prefs` row.
**Steps:** `drizzle-kit generate` in CI (non-TTY); apply `migrate`.
**Expected Outcomes:** exactly one generated migration, no prompt; the seeded row survives with `target` and
`reason` null and its original `sentiment`.

## Test Run

_To be filled during execution. Per server/CLAUDE.md: unit tests for repo/service/ranking, integration for
routes, offline stubs only, as few as cover all paths. `npm test` drops the dev DB — run it before demos._

## Deployment Strategy

Direct deploy; low risk. The migration is additive (one nullable-relaxation + two nullable adds + two enum
values) → a single non-interactive migration, so the drop+add split gotcha
(`docs/harvest-principles.md`) does not apply. The feature is **inert until a user sets a `target`**: no
existing behavior changes on deploy. Order: (1) ship schema + ingest tagging + ranking read; (2) run the
backfill script; (3) enable the chef tool + settings surface. If moderation over/under-fires, `MODERATION_WEIGHT`
is a one-line tuning revert. No feature flag needed; optionally gate the settings UI until backfill completes.

## Production Verification

### Production Verification 1: End-to-end limit-red-meat
**Preconditions:** prod; a test household onboarded via iMessage.
**Steps:** import a beef recipe (drop a link); text the chef "trying to limit red meat, though I do love
steak"; open the ranked deck / next recommendation.
**Expected Outcomes:** the beef recipe carries `food_category='red_meat'`; the member has a
`(food_category, red_meat, target<0, sentiment=like)` row with a reason; red-meat recipes rank lower but
still appear; the chef's confirmation reads as "less, not never" and doesn't claim dislike.

### Production Verification 2: Backfill coverage
**Preconditions:** prod post-backfill.
**Steps:** sample N existing recipes with obvious red-meat ingredients; check their `recipe_categories`.
**Expected Outcomes:** each carries the expected `food_category` rows; backfill logs show the corpus count
tagged, no silent truncation.

## Production Verification Run

_To be filled after deploy. Verify against live reality — reproduce on a real thread + real import, not a
staging stub._
