# WI-4: Poll tally + debounced chef reaction

## Background

With votes accumulating in `poll_votes` (WI-3), the chef needs to (a) read the current tally and
(b) react when votes land — but a burst of votes must not fire a turn per vote. We add a
`poll__tally` read tool and a **debounced** trigger: after a vote upsert, schedule one chef turn
after a short quiet period, fed the current standings (design D1 reaction; Q-03 debounce window).
Depends on WI-3.

## Objective

Give the chef a tally read and a debounced, single-turn reaction to voting activity so it can act
on results (e.g. "Tacos won, want me to plan that?") without spamming.

## Acceptance Criteria

1. Given a poll with votes, when `poll__tally({pollMessageGuid})` is called, then it returns each
   option's text and current vote count/voters (from `poll_votes` where `selected=true`).
2. Given N vote deltas within the debounce window, when they are applied, then exactly one chef
   turn fires after the quiet period (not N), and it sees the final tally.
3. Given no further votes after the window, when it elapses, then the turn runs once with the
   then-current standings.
4. Given the tally read for a poll with no votes, then it returns all options with zero counts (a
   valid empty state, not an error).

## Test Cases

### Test Case 1: tally read (unit)
**Preconditions:** seed `poll_votes`: opt2 by A and B, opt1 by none.
**Steps:** call `poll__tally({pollMessageGuid})`.
**Expected Outcomes:** `[{option:'Pizza',count:0,voters:[]},{option:'Tacos',count:2,voters:[A,B]},…]`.

### Test Case 2: debounce coalesces a burst (unit, fake timers)
**Steps:** apply 5 vote deltas within the window, then advance the clock past it.
**Expected Outcomes:** the turn-trigger fires exactly once; asserts the tally passed reflects all 5.

### Test Case 3: empty tally
**Steps:** call `poll__tally` on a poll with no votes.
**Expected Outcomes:** all options at count 0; no throw.

## Test Run
_To be determined._

## Deployment Strategy

Direct deploy; additive tool + trigger. Start the debounce at ~5s (Q-03) and tune. Rollback:
disable the trigger (tally read is harmless to leave).

## Production Verification

### Production Verification 1: One reaction per burst
**Preconditions:** deployed; a live poll.
**Steps:** have two people vote in quick succession.
**Expected Outcomes:** the chef sends one summarizing message reflecting both votes, not two.

## Production Verification Run
_To be determined._
