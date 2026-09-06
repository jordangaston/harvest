# WI-02 — Timezone fact + settings recompute (tz change, weekly-meals pause)

## Background

WI-01 provisions reminder crons in `DEFAULT_TZ`. `server/docs/meal-reminders/DESIGN.md`
(§§ F-04, F-05, Tables household_preferences, Decisions) makes them react to
settings: a household-scoped TIMEZONE fact whose write recomputes the crons, and a
weekly-meals write that derives each course row's pause state — with a user-explicit
pause (`pausedByUser` in the row's `input` JSON, arriving in WI-03) that a preference
recompute must never override.

## Objective

Setting the household timezone (conversationally, as a fact) shifts every reminder
cron to the new zone; changing a course's weekly meal count to/from 0 pauses/resumes
its row — without resurrecting a user-paused course.

## Acceptance Criteria

1. Given the migration, then `household_preferences.timezone` exists (nullable text,
   IANA).
2. Given a new TIMEZONE fact type (registered like GROCERY_SHOPPING_DAY in
   fact-types.ts), when the chef writes it (e.g. household says "we're in Austin" →
   model supplies `America/Chicago`), then the value is IANA-validated, persisted to
   `household_preferences.timezone`, and the persist chokepoint calls the reminders
   recompute — every `meal_reminder` row for the household's thread gets its cron
   re-derived in the new zone with `next_run_at` recomputed (DESIGN F-04).
3. Given `WeeklyMealCountType.persist` (the existing per-course fact write —
   fact-types.ts:266 per DESIGN), when a course count crosses to 0, then that course's
   row is paused; when it rises from 0, the row resumes UNLESS `input.pausedByUser`
   is true (DESIGN F-05 precedence: `is_paused = count===0 || pausedByUser`).
4. Given no timezone fact yet, then provisioning and recompute fall back to
   `DEFAULT_TZ` env (and `UTC` if unset) — never throw.
5. The household→thread resolution used by recompute is the join described in DESIGN
   F-05 (`dynamic_cron_jobs.owner_id = threads.id WHERE household_id = ?`), not a new
   repository method, unless implementation proves the join impractical (justify in
   the spec if so).

## Test Cases

Vitest, files individually, `pkill -f vitest` between runs; canonical suite `npm test`
with the dev server stopped.

### Test Case 1: timezone write shifts crons (AC-2)

**Preconditions:** provisioned rows in `DEFAULT_TZ=UTC` (dinner 16:30 UTC); household
+ thread wired.

**Steps:** Persist timezone `America/Chicago` through the fact type. Inspect rows.

**Expected Outcomes:** dinner row's next fire corresponds to 16:30 America/Chicago;
all courses shifted; invalid value (e.g. "CST", "Austin") rejected by validation and
nothing changes.

### Test Case 2: pause rule truth table (AC-3)

**Steps:** For the four combinations of (count 0/nonzero × pausedByUser true/false),
run the weekly-meals persist and assert `is_paused` = `count===0 || pausedByUser`.
The critical case: count 0→3 with `pausedByUser: true` stays paused.

### Test Case 3: fallback (AC-4)

**Steps/Expected:** no timezone anywhere + `DEFAULT_TZ` unset → provisioning succeeds
in UTC; with `DEFAULT_TZ=America/New_York` → rows derive from it.

## Test Run

Implemented on branch `jordangaston/first-meal-plan` (2026-09-05). All ACs covered by tests added to
`test/meal-reminders.test.ts` (10 new WI-02 cases alongside the 12 WI-01 cases).

**AC-1 (migration).** No new migration — migration `0042_black_zombie.sql` (WI-01) already adds
`household_preferences.timezone` (nullable text) and `dynamic_cron_jobs.meal`. `schema.ts`, the
`HouseholdPreferences` model, and `HouseholdPreferenceRepository.savePreferences` already carry the
column as a 1:1 field. Satisfied; nothing generated.

**Key finding on IANA validation.** croner AND `Intl.DateTimeFormat` both silently accept `"CST"`,
`"EST"`, `"PST"` (legacy aliases) — they would NOT reject the abbreviations AC-2 names. Validation
therefore checks membership in the canonical `Intl.supportedValuesOf('timeZone')` set (plus `UTC` and
`Etc/*` fixed-offset zones, which are legal but omitted from that list). This rejects `CST`/`EST`/
`PST`/`Austin` while accepting `America/Chicago`/`UTC`/`Etc/UTC`. Verified at the node REPL and in
`WI-02 Test Case 1 > rejects an abbreviation ("CST") and a city name ("Austin")`.

**Breakfast interaction (decided).** WI-01 ships breakfast provisioned-but-paused with `NO_TIMING_CRON`
and no `pausedByUser` marker (DESIGN Q-04). `syncPause`/`recompute` are keyed per-course, so a breakfast
weekly-count sync applies the same `count === 0 || pausedByUser` rule to the breakfast row; a
recompute only moves `input.tz` + `next_run_at`, never a course's pause. Since breakfast has no
`pausedByUser` marker and its provisioned weekly count is 0 in the tests, both operations leave its
pause exactly as WI-01 set it. No special-casing needed — the general rule already honors Q-04.

**Household → thread resolution (AC-5).** The F-05 join lives in `ReminderRepository.householdReminders`
(`dynamic_cron_jobs.owner_id = threads.id WHERE threads.household_id = ?`), shared by `recompute` and
`setPausedByHousehold`. No new `ThreadRepository` method.

**pausedByUser precedence.** The `count === 0 || pausedByUser` rule lives in
`ReminderRepository.setPausedByHousehold`, which reads the row's OWN stored `input.pausedByUser` and
ORs it with any incoming flag — so a preference recompute can never resurrect a user-paused course.
The weekly-count path passes no flag; WI-03's enable/disable tool stamps the row's marker.

Targeted file:
```
$ npx vitest run test/meal-reminders.test.ts
 ✓ test/meal-reminders.test.ts (22 tests) 1803ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

WI-02 cases (all green):
- Test Case 1 (AC-2): `America/Chicago` shifts every course's `input.tz` + `next_run_at`; the cron
  string (local wall-clock) is unchanged and the next fire is 16:30 local (DST-robust assertion);
  `CST`/`Austin`/`EST`/`PST` rejected with no change; a household with no reminders is a no-op.
- Test Case 2 (AC-3): the 4-combination truth table for `is_paused = count === 0 || pausedByUser`,
  incl. the critical `count 3 + pausedByUser` stays paused; plus the bump case (count-paused resumes,
  user-paused does not).
- Test Case 3 (AC-4): no tz fact ⇒ provisioning + recompute both fall back to `DEFAULT_TZ` (UTC) and
  never throw.

Full suite from clean (dev server stopped):
```
$ pkill -f "nitro dev"; npm test
 Test Files  84 passed (84)
      Tests  651 passed | 1 skipped (652)
   Duration  25.68s
```

## Deployment Strategy

Additive migration; deploy after WI-01 (needs the reminder rows/service). Existing
households have no timezone fact — `DEFAULT_TZ` governs until Sage learns it in
conversation. Rollback: plain code rollback; column ignored by old code.

## Production Verification

### PV-1: timezone learned in conversation

**Steps:** From the test thread tell Sage the city/state; check
`household_preferences.timezone` and the reminder rows' recomputed `next_run_at`.

**Expected Outcomes:** IANA zone persisted; crons shifted; log line for the recompute.

## Production Verification Run

To be filled after deploy.
