---
tags: [swipe-ui]
summary: "UX-study plan for the recipe swipe deck + ranking-settings prototype"
locked: false
---

# Swipe Deck & Settings — UX Study Plan

## Purpose

Validate that the swipe prototype (`SwipeDeck` in the Design Studio) and the ranking-settings surface are
learnable, trustworthy, and mirror the Bumble swipe + filter patterns adapted to recipes. We answer:

1. **Is the swipe model obvious?** Do people know right = like, left = pass, up = cook-this-week without help
   beyond the one first-use hint?
2. **Does the tuning loop feel low-friction and worth it?** Do people use the dislike-reason chips (not
   ignore them, not feel forced), and does the confirmation make the effect legible?
3. **Do people trust it?** Does optimistic swiping ever feel like a lost or double-counted action — including
   the save-failure recovery?
4. **Is the hard-vs-soft distinction clear?** Can people tell which settings **hide** recipes (filters) from
   which only **reorder** (preferences), and do they grasp "changes apply to the next batch"?
5. **Do the return moments land?** Does the like confirmation feel rewarding, and does the "plan your week"
   nudge route people toward meal planning?

## Method

- **Format:** moderated, think-aloud, ~30 min per participant, plus a 5-min debrief.
- **Apparatus:** the app in dev mode → `🎞 Studio` → **SwipeDeck** study, run on an iOS simulator or a
  device. The study's controls (Start state `deck`/`empty`/`error`, *Simulate save failures*, *Reduce
  motion*) let the moderator stage each condition without code changes.
- **Participants:** 5–8 target users (people who cook a few nights a week and have used a swipe app). One
  pilot session first to shake out the script.
- **Instrumentation:** the client telemetry already wired via `analytics.track` (see the design doc
  § Telemetry) captures the quantitative metrics below; the moderator captures the qualitative.

## Tasks reviewers perform

Each task has a prompt and a pass criterion (completed unaided = pass).

| # | Task prompt to the participant | Observing |
| --- | --- | --- |
| 1 | "Find two dinners you'd actually make tonight, and skip ones you wouldn't." | Do they swipe unprompted? gesture vs. button? does the first-use hint land? |
| 2 | "You passed on that one — is there a way to tell us *why*? Do it for one, skip it for another." | reason-chip discovery + the skip path; does the confirmation register? |
| 3 | "Before deciding on this card, find out what's in it and why it's suggested for you." | detail-sheet discovery; is the "why" line + breakdown understood? |
| 4 | "One of these is a definite for this week — is there a stronger signal than a like?" | super/"Cook this week" discovery + its meaning |
| 5 | "You didn't mean to skip that last one — undo it." | undo discovery + does it feel reliable? |
| 6 | *(moderator sets Start state → empty)* "What would you do here?" | is the empty/cooldown state understood? do the CTAs pull toward settings/plan? |
| 7 | *(moderator sets Simulate save failures)* "Keep swiping." | does the rollback read as "not saved, try again" — never a lost/ghost swipe? |
| 8 | "Open your preferences. Make price matter less, and make sure you never see peanuts. Which of those changes *hides* recipes and which just *reorders* them?" | the hard-vs-soft distinction; the "applies to next batch" banner; control legibility |
| 9 | *(moderator sets Reduce motion)* "Swipe a couple more." | does the experience still work and feel intentional without the fling? |

## How comments are collected

Three channels, combined in analysis:

1. **On-canvas pins (in-studio).** In the SwipeDeck study, the moderator (or participant) taps **Comment**,
   then taps the exact spot on the component to drop a numbered pin with a note. Session pins persist to
   AsyncStorage; durable/shared findings are written to the committed `design/comments/SwipeDeck.comments.ts`
   so they travel with the code and show up as pins for the next reviewer.
2. **Frontend-architect pass (already done).** The pre-human review gate (ponytail + refactoring-ui) seeded
   architecture/visual findings as pins in the same file; those are addressed before sessions begin, so
   study participants react to a clean build, not known defects.
3. **Post-task debrief.** Five questions: which gesture was least obvious; did any swipe feel lost; could you
   tell filters from preferences; did the "why" line feel accurate; what would you change first.

## Success metrics

Quantitative targets (from the telemetry events; a metric that misses becomes the next iteration's focus):

| Metric | Source event(s) | Target |
| --- | --- | --- |
| Unaided swipe-task completion (Task 1) | `Recipe Swiped` | ≥ 90% of participants |
| Hard-vs-soft correctly articulated (Task 8) | debrief + `Settings Preference Changed` | ≥ 80% |
| Reason-chip usage rate | `Swipe Reason Chosen` ÷ dislikes | between 20% and 60% (used, not forced) |
| Reason-chip skip is easy | `Swipe Reason Skipped` present, no frustration | qualitative — no one stuck |
| Median time-per-card | `Deck Card Shown` → `Recipe Swiped` `msVisible` | < 6 s (glanceable) |
| Like ratio sanity | `Recipe Swiped` | 20–60% likes (deck isn't all-yes or all-no) |
| "Lost a swipe" reports (incl. Task 7 rollback) | debrief + rollback observation | **0** |
| Gesture-hint sufficiency | observation (Task 1) | ≥ 90% swipe correctly after the single hint |
| Nudge → plan intent | `Plan Nudge Shown` → `Plan Nudge Tapped` | ≥ 30% tap-through when shown |
| Detail-open rate | `Card Detail Expanded` | tracked (baseline, not pass/fail) |
| Deck-exhaustion rate | `Deck Exhausted` | tracked; a high rate cross-checks ranking over-filtering |

Qualitative bar: participants describe the swipe model in their own words correctly, never report a
lost/ghost swipe, and can point to *which* controls remove recipes vs. reorder them.

## Analysis & next steps

- Triage the pinned comments (studio + debrief) by frequency × severity; the top cluster sets the next
  iteration.
- Any missed quantitative target maps to a specific fix (e.g., low reason-chip usage → make the chooser more
  discoverable or the confirmation more concrete; hard-vs-soft confusion → strengthen the two-group visual
  separation).
- Feed deck-exhaustion and like-ratio back to the ranking team — they cross-check the engine's
  `ranked_filtered_ratio` (over-filtering) independent of the UI.

## Open dependencies

- Live persistence for settings and a durable like-count depend on the proposed backend follow-ups
  (`GET/PUT /v1/preferences`, a Liked-cookbook count — design doc Q-09, Q-12). Until they land, Task 8 tests
  comprehension and layout against a local draft, not real persistence, and the nudge counts session likes.
