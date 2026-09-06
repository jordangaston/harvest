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

Executed 2026-09-05 on branch `jordangaston/first-meal-plan`.

### Migration (AC-1) — `test/grocery-migration.test.ts`

Reconstructs the pre-0043 state (old user-scoped `grocery_items` + `users`/`households`/
`household_members`/`recipes`), seeds a row each for user A and B (both members of H1) and
user C (no membership), runs the real `drizzle/0043_household_grocery_items.sql`, and asserts.

```
✓ test/grocery-migration.test.ts (2 tests)
  ✓ backfills household_id + added_by_user_id, deletes orphans, and drops user_id
  ✓ is safe to re-run the backfill before the drop (idempotent, deterministic)
```

A + B rows carry `household_id = H1` and their own `added_by_user_id`; C's orphan row is
deleted; `user_id` column dropped; `grocery_items_household_idx` present, `grocery_items_user_idx`
gone. Verified the whole journal (44 migrations incl. 0043) applies cleanly on an empty DB.

### Endpoints re-auth + household scope (AC-2, AC-3, AC-4, AC-5) — `test/grocery.test.ts`

```
✓ test/grocery.test.ts (11 tests)
  grocery items API: adds/merges/recipe-items/check-edit-delete; 404s another household's
    item; rejects empty add + unauthenticated read; NO_HOUSEHOLD 409 (not 500) for a
    household-less caller (list AND add).
  household scoping: member A sees + checks off B's item; A's eggs + B's eggs merge to one
    line (amount 5); a second household's list is isolated.
```

### O-03 resolver — `test/increment2-repositories.test.ts`

```
✓ HouseholdRepository > householdIdForUser resolves a member to their household;
  null for a non-member (O-03)
```

### Unit (AC-6) — `test/grocery-unit.test.ts`

```
✓ test/grocery-unit.test.ts (7 tests)   — service/catalog add+merge over the household-scoped fake repo
```

### Canonical suite — `npm test` (dev server stopped)

```
Test Files  85 passed (85)
     Tests  666 passed | 1 skipped (667)
```

Notes:
- The migration's step 3 is the **point of no return** (drops `user_id`); steps 1–2 are
  additive and re-runnable, proven by the idempotency test. Deploy code + migration together
  (DESIGN § Deployment) — old mobile clients keep working (wire shapes unchanged; the public
  `toPublicGroceryItem` shape exposes neither `user_id` nor `household_id`).
- `UserRepository.deleteAccount` no longer deletes `grocery_items` — the list belongs to the
  household now, and `added_by_user_id` is `set null` on user delete (attribution only).
- `npm test` now sets `ulimit -n 30000` (the documented libSQL/vitest fd remedy): the
  pre-existing per-migrate fd leak in libSQL's `client.close()` (verified identical on the
  clean base — 21→63 fds over 35 cycles) tipped one fd-heavy file over the default worker
  limit once this WI added a migration. Not a regression in this change.

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
