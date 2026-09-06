# WI-03 — Conversational grocery tools (resident)

## Background

`server/docs/groceries-chef/DESIGN.md` (§§ F-01..F-04, Modules, O-01, Decisions incl.
the discovery-measured-negative record) gives Sage the mobile tab's actions
conversationally: view, add, remove, check off. RESIDENT in the objectives the design
wires (discovery meta-tool deliberately NOT built — the L1/L2 seam stays on paper).
Requires WI-01 (household scope); WI-02 recommended first so tool tests can assume
sync exists.

## Objective

Four `grocery__*` chef tools over the household's list via `GroceryService`, plus the
one-line briefing hint after the first generate, matching the design's tool contracts.

## Acceptance Criteria

1. `grocery__view` returns the household's list per DESIGN § tool contract (grouped or
   flat exactly as the doc specifies) — read-only.
2. `grocery__add` adds items (name, optional amount/unit/quantity_text) through
   `GroceryService.add` — server resolves aisle/icon/default-unit, manual merge by
   name+unit applies, `added_by_user_id` = initiator.
3. `grocery__remove` and `grocery__check` resolve a SPOKEN name to a row via the O-01
   name-resolution logic: exact/normalized match acts; no match or ambiguous match
   returns unmatched + candidates in the tool result so the model asks instead of
   guessing — never delete on a guess. Check toggles or sets per the doc's contract.
4. All four follow the ChefTool pattern (canRun gates on householdId, zod schemas,
   FACTORIES registration) and are wired into the objective tool lists the design
   names as resident.
5. The briefing hint (one line, DESIGN's revision-1 addition) mentions the stocked
   list after the first meal-plan generate — prompt-only, no code path.
6. O-01 name resolution is a pure function with unit tests (the design calls it the
   one unit-test-worthy logic).

## Test Cases

Vitest, files individually, `pkill -f vitest`; canonical `npm test`, dev server
stopped.

### Test Case 1: O-01 table test (AC-3, AC-6)

**Steps:** exact name, case/plural variant, substring ("the chicken" → "chicken
breast" sole match), ambiguous (two chicken rows) → candidates, no match → unmatched.

### Test Case 2: add + household merge (AC-2)

**Steps:** tool adds "2 eggs" when the household already has 3 → one row amount 5;
adder recorded.

### Test Case 3: remove/check act only on certainty (AC-3)

**Steps:** remove "chicken" with two chicken rows → nothing deleted, candidates
returned; check "milk" (one row) → checked true.

### Test Case 4: registration + canRun (AC-4)

**Steps:** built tool set for the wired objectives includes the four; no-household
context filters them out.

## Test Run

New test file — `test/chef-grocery-tools.test.ts` (run individually):

```
 ✓ test/chef-grocery-tools.test.ts (12 tests) 950ms
   ✓ O-01 name resolution (TC-1, AC-3/AC-6) > exact name matches
   ✓ O-01 name resolution (TC-1, AC-3/AC-6) > case + plural variant matches ("Eggs" → "eggs")
   ✓ O-01 name resolution (TC-1, AC-3/AC-6) > substring resolves to a sole match ("the chicken" → "chicken breast")
   ✓ O-01 name resolution (TC-1, AC-3/AC-6) > ambiguous name returns candidates, no match
   ✓ O-01 name resolution (TC-1, AC-3/AC-6) > no match returns unmatched
   ✓ grocery__add + household merge (TC-2, AC-2) > adds "2 eggs" onto an existing line of 3 → one row, amount 5; adder recorded
   ✓ grocery__remove / grocery__check act only on certainty (TC-3, AC-3) > remove "chicken" with two chicken rows → nothing deleted, candidates returned
   ✓ grocery__remove / grocery__check act only on certainty (TC-3, AC-3) > check "milk" (one row) → checked true
   ✓ grocery__remove / grocery__check act only on certainty (TC-3, AC-3) > remove an unmatched name deletes nothing and reports it
   ✓ grocery__view (AC-1) > returns count + items for the household, read-only
   ✓ registration + canRun (TC-4, AC-4) > first_meal_plan builds all four grocery tools
   ✓ registration + canRun (TC-4, AC-4) > a no-household context filters the grocery tools out

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

`tsc --noEmit`: clean.

Canonical `npm test` from clean (dev server stopped), verified by the coordinator:

```
 Test Files  87 passed (87)
      Tests  683 passed | 1 skipped (684)   (exit 0)
```

(`test/imessage-consumer-logic.test.ts` also confirmed individually: 35 passed.)


## Deployment Strategy

Code-only; after WI-01 (WI-02 ordering per above). Rollback: plain code rollback.

## Production Verification

### PV-1: conversational round-trip

**Steps:** Text Sage: "add tortillas and 2 avocados", "check off the milk", "take
chicken off the list" (ambiguous on purpose). Check the app tab between each.

**Expected Outcomes:** adds merge/appear in the app instantly; check-off reflects;
the ambiguous remove makes Sage ask which chicken item, not guess.

## Production Verification Run

To be filled after deploy.
