# WI-01 — Household-scoped grocery list: migration + endpoint auth

## Background

`server/docs/groceries-chef/DESIGN.md` (the contract — §§ Tables, Deployment,
APIs, Decisions) moves the grocery list from user scope to HOUSEHOLD scope: one list
per household, member A's eggs merging with member B's. This WI is the data-model
move and REST re-auth only — sync, tools, and the card build on it (WI-02..04).

## Objective

`grocery_items` is household-scoped (with free `added_by_user_id` attribution), the
five existing REST endpoints authorize via the caller's household membership with
unchanged paths/shapes, and merging keys on the household.

## Acceptance Criteria

1. Given the 3-step migration (DESIGN § Deployment): add nullable `household_id` +
   `added_by_user_id` → backfill `household_id` via the unique
   `household_members.user_id` mapping and `added_by_user_id = user_id`, DELETING
   orphan rows (users with no membership) → make `household_id` not-null, drop
   `user_id`, index `grocery_items_household_idx`. Deterministic and idempotent-safe
   to re-run before step 3.
2. Given `HouseholdRepository.householdIdForUser(userId)` (one new method, indexed
   single lookup), then all five endpoints (GET/POST /v1/grocery_items,
   PATCH/DELETE /v1/grocery_items/:id, GET /v1/ingredients/common untouched) resolve
   the caller's household from the token and scope every read/write to it — the
   household id is never accepted from the client. A caller with no household gets a
   clean 4xx per the design (not a 500).
3. Given two members of one household, when A lists, then A sees items B added;
   PATCH/DELETE authorize by household membership (member A can check off B's item);
   cross-household access is impossible by construction.
4. Given `findMergeCandidate`, then it keys on (householdId, name, unit) — A adding
   "2 eggs" then B adding "3 eggs" yields one row, amount 5.
5. POST records `added_by_user_id` = caller; no UI/response changes depend on it
   beyond including it if the design's wire shape says so (follow § APIs exactly —
   the mobile client must keep working unmodified).
6. GroceryService/GroceryRepository signatures move to householdId per DESIGN
   § Modules; models updated (Zod) with rows parsed at the boundary.

## Test Cases

Vitest, files individually, `pkill -f vitest`; canonical `npm test`, dev server
stopped.

### Test Case 1: migration backfill (AC-1)

**Preconditions:** pre-migration-shaped seed: items for user A (member of H1), user B
(member of H1), user C (no membership).

**Steps:** Run the migration.

**Expected Outcomes:** A+B rows carry H1 + their adder ids; C's rows gone; user_id
column gone; unique/index state per design.

### Test Case 2: endpoints re-auth (AC-2, AC-3)

**Steps:** As member A: list shows B's items; patch B's item succeeds; as a user in
another household: A's item ids 404. As a household-less user: clean 4xx on list.

### Test Case 3: household merge (AC-4)

**Steps:** A adds 2 eggs; B adds 3 eggs → one row, amount 5, household H1.

## Test Run

To be filled during execution.

## Deployment Strategy

Step 3 is backwards-INCOMPATIBLE (drops `user_id`) — code and migration deploy
TOGETHER (DESIGN § Deployment). Old mobile clients keep working (wire shapes
unchanged). Rollback requires restoring from the pre-step-3 state — call out the
point of no return in the Test Run notes; steps 1–2 are safe to run early.

## Production Verification

### PV-1: mobile app parity

**Steps:** From the app: list, add, check, delete — all behave as before; a second
household member sees the same list.

## Production Verification Run

To be filled after deploy.
