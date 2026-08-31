# WI-02 — Increment-2 repositories: ObjectiveStore + household repos

## Background

WI-01 adds the increment-2 tables (`households`, `household_members`, `household_preferences`,
`objectives`, `slots`) and their Zod models. WI-02 adds the **data access** on top of them — the
classes the Chef and the turn commit through. It depends on WI-01 and ships no Chef wiring, no
services, no HTTP; only repositories plus their offline tests.

Two clusters of behaviour, from `increment-2-reasoning-and-onboarding.md`:

- **The objective stack + slot scoreboard** (`ObjectiveStore`). Each turn loads the active
  objective and its *unfilled* slots, applies the reasoning component's slot updates under one
  DB-side invariant, and — on completion — pops the objective and activates the next. The design's
  load-bearing properties: **lock-free background push** (an `INSERT`, not a lock-held
  read-modify-write) and **unfilled-only loading** (`WHERE status != 'filled'`) for tight context.
- **The household + preferences repos.** Creating a household and adding members as they are
  identified (idempotently, one household per user), and read-merge-write on
  `household_preferences` mirroring the existing `PreferenceRepository` (`server/CLAUDE.md`).

House conventions this work follows (`server/CLAUDE.md`, `thread-repository.ts` as the template):
- **Class + `static create(db)`**; constructor takes the `db` singleton.
- **`db.transaction()` for multi-table / read-modify-write**, passing `tx` to each write; accept an
  optional `Executor` (db-or-tx) param on methods a caller may want to enlist in an outer tx —
  exactly the `Executor = this.db` pattern `ThreadRepository` uses, so the turn can commit slot
  updates + cursor + outbound rows in **one** transaction.
- **Zod parse at the read boundary** (`return ObjectiveSchema.parse(row)`); never cast `$inferSelect`.
- **Methods small (~≤10 lines), readable; TSDoc on public methods.**
- **The one enforced invariant lives once, at the shared boundary** every caller routes through
  (`applySlotUpdates`), not in each call site (`server/CLAUDE.md` "enforce cross-cutting invariants
  once").

## Objective

Ship three repository classes with offline tests:
1. `ObjectiveStore` (`src/chef/objective-store.ts`) — the `objectives` + `slots` tables.
2. `HouseholdRepository` (`src/repositories/household-repository.ts`) — households + members.
3. `HouseholdPreferenceRepository` (`src/repositories/household-preference-repository.ts`) —
   `household_preferences` read-merge-write.

Everything is testable offline with `migratedFileDb()`; no method hits the network.

## Component 1 — `ObjectiveStore` (`src/chef/objective-store.ts`)

The `Executor` type (db-or-tx) is copied from `thread-repository.ts`. All value-JSON columns
round-trip through the WI-01 models.

### `loadActive(threadId): Promise<{ objective: Objective; slots: Slot[] } | null>`
Loads the thread's `status = 'active'` objective and its **unfilled** slots
(`status != 'filled'`). Returns `null` when the thread has no active objective.
- Query 1: the active objective (`WHERE thread_id = ? AND status = 'active'`), parse with
  `ObjectiveSchema`; `null` if none.
- Query 2: slots `WHERE objective_id = ? AND status != 'filled'`, parsed with `SlotSchema`, using
  the `slots_objective_status_idx` index.
- Read-only ⇒ uses `this.db` (no tx).

### `pushObjective({ threadId, definition, slots, position }, tx?): Promise<Objective>`
Inserts a new objective plus its slot rows. `position` is `'top' | 'bottom'`.
- `'top'` — `stack_position = MAX(stack_position) + 1` for the thread; the new objective is
  inserted `status = 'active'` and any currently-active objective for the thread is set to
  `'suspended'` **first** (so the partial-unique index never sees two actives). **Called under the
  turn lock** (a digression), so the `MAX + 1` read-then-write is race-free.
- `'bottom'` — `stack_position = MIN(stack_position) - 1`, inserted `status = 'suspended'`. **This
  is the lock-free background push** — no active-row demotion, a pure `INSERT`, so a scheduled goal
  adds one without taking the thread lock. First objective on an empty thread: `stack_position = 0`
  (or `1`) and `status = 'active'` regardless of `position` [ASSUMPTION: an empty-stack push is
  always `active` — you cannot suspend under nothing; confirm a background push onto an empty
  thread should still become active immediately].
- `slots` is the definition's slot specs (`{ key, scope, memberUserId?, required }[]`), inserted at
  `status = 'unasked'`.
- Multi-table ⇒ wrapped in `db.transaction()` (or the passed `tx`).
- Returns the inserted objective, parsed.

`// ponytail: MAX(stack_position)+1 read-then-write is safe only because a top-push runs under the
per-thread lock; a background (bottom) push is INSERT-only so it needs no lock. Don't move the
top-push off the lock without a fence.`

### `applySlotUpdates(updates, tx): Promise<void>` — the invariant lives here
Applies the reasoning component's declared slot status changes. `updates` is
`{ slotId, status, value? }[]`. **The one enforced rule (design § "the agent judges filled-ness;
code enforces one invariant"):** a slot may transition to `status = 'filled'` **only if a value is
present** — either supplied in the update (`value !== undefined`) or already stored on the row.
An update that sets `'filled'` with no value present is rejected (throw), because the model can't
claim progress the database doesn't have. Non-`filled` transitions (`asked`, `defaulted`) and
value-less updates to non-`filled` statuses are applied as-is.
- Takes an explicit `tx` (it always runs inside the turn's commit transaction).
- For each update: if `status === 'filled'`, assert the effective value is non-null (from the
  update or a re-read of the row) or throw; then `UPDATE slots SET status = ?, value = ? WHERE id = ?`.
- [ASSUMPTION: "a value present" means non-`undefined`/non-`null` JSON. A slot that is legitimately
  filled with an empty value (e.g. "no allergens") should be filled with an explicit sentinel like
  `[]`, not `null` — the caller (Chef) is responsible for passing `[]`, not omitting the value.
  Confirm the empty-answer encoding with the onboarding field map.]

### `completeAndPop(objectiveId, tx): Promise<Objective | null>`
Marks the objective `status = 'complete'`, `completed_at = now`, then activates the
next-highest-`stack_position` `suspended` objective **on the same thread** (if any).
- Takes an explicit `tx` (commits with the turn).
- Set the target complete; `SELECT` the max-`stack_position` suspended sibling; if one exists,
  `UPDATE ... SET status = 'active'`. Returns the newly-activated objective (parsed) or `null` when
  the stack is now empty.
- Because the completed row is no longer `active`, activating the next never trips the partial
  unique index.

### `isComplete(objectiveId): Promise<boolean>`
`true` when the objective has **zero required, non-terminal slots** — i.e.
`COUNT(*) WHERE objective_id = ? AND required = 1 AND status NOT IN ('filled','defaulted') == 0`.
Terminal = `filled` or `defaulted` (a defaulted required slot counts as done, per the design).
Read-only ⇒ `this.db`.

## Component 2 — household repos

### `HouseholdRepository` (`src/repositories/household-repository.ts`)

- **`createHousehold({ ownerUserId, name? }, tx?): Promise<Household>`** — inserts a `households`
  row (`owner_user_id = ownerUserId`), returns it parsed with `HouseholdSchema`. Accepts an
  `Executor` so the turn can enlist it. [ASSUMPTION: creating a household does **not** auto-insert
  the owner into `household_members` — the turn calls `addMember` for each identified participant
  including the owner, matching the design's "memberships created per member as they're identified."
  Confirm the owner is added like any other member.]
- **`addMember({ householdId, userId }, tx?): Promise<void>`** — inserts a `household_members` row;
  **idempotent on the unique `user_id`** via `onConflictDoNothing({ target: householdMembers.userId })`
  (one household per user in v1). Re-adding the same user is a no-op; adding a user already in a
  *different* household is silently ignored by the same conflict [ASSUMPTION: v1 has one household
  per user, so a cross-household re-add is out of scope — `onConflictDoNothing` on `user_id` is the
  intended behaviour, not an error. Confirm we don't need to *move* a user between households in
  increment 2.]
- **`loadMembers(householdId): Promise<HouseholdMemberView[]>`** — the briefing's member list, one
  `households ⋈ household_members ⋈ users` join returning `{ userId, name, imessageHandle }`
  (name/handle joined from `users`, never denormalized). Parsed into a small view model.

### `HouseholdPreferenceRepository` (`src/repositories/household-preference-repository.ts`)

Mirrors `PreferenceRepository`'s **read-merge-write** shape (it is the pattern the design's
`save_household_profile` tool calls through), but 1:1 on `household_id` and household-scoped fields
only.

- **`getPreferences(householdId): Promise<HouseholdPreferences>`** — reads the
  `household_preferences` row; returns it parsed with `HouseholdPreferencesSchema`. If no row
  exists yet, returns the **defaults** (the column defaults: `eats_leftovers = true`,
  `equipment_reviewed = false`, `household_adults = 2`, `household_kids = 0`, the JSON/nullable
  fields empty/null) rather than throwing [ASSUMPTION: household preferences have no goals-derived
  cold-start like `user_preferences` — the defaults are the static column defaults. Confirm no
  goal-seeded weights are needed (see WI-01's household-preferences ASSUMPTION).]
- **`savePreferences(householdId, patch): Promise<HouseholdPreferences>`** — a **read-merge-write**:
  ensure the row exists (`insert ... onConflictDoNothing` with the defaults), then `UPDATE` only the
  keys present in `patch` (a partial patch — the `save_household_profile` tool sends a subset),
  bumping `updated_at`. Returns the re-resolved preferences. Idempotent read-merge-write =
  last-writer-wins on scalars, matching the design's concurrency invariant (`SaveResult` runners
  converge under a rare double-run).

`// ponytail: partial-patch UPDATE (only patch keys), last-writer-wins per scalar — the design's
idempotent-read-merge-write invariant. Set-union semantics (e.g. allergens) live on the member
repo, not here.`

## Acceptance Criteria

### AC-1 — loadActive returns the active objective + only its unfilled slots
**Given** a thread with one active objective whose slots are a mix of `unasked`/`asked`/`filled`/`defaulted`,
**When** `loadActive(threadId)` is called,
**Then** it returns that objective and exactly the slots with `status != 'filled'` (unasked, asked,
and defaulted included; filled excluded); and returns `null` for a thread with no active objective.

### AC-2 — pushObjective positions top vs bottom and preserves the one-active invariant
**Given** a thread with an active objective at `stack_position = 1`,
**When** `pushObjective(..., position: 'top')` is called,
**Then** the prior active is set `suspended`, the new objective is `active` at `stack_position = 2`,
and no unique-constraint error is raised;
**And** `pushObjective(..., position: 'bottom')` inserts a `suspended` objective at `MIN - 1`
(here `0`) without demoting the active one;
**And** a push onto a thread with no objectives yields an `active` objective.

### AC-3 — applySlotUpdates enforces filled-requires-value
**Given** a slot at `status = 'asked'` with `value = null`,
**When** `applySlotUpdates([{ slotId, status: 'filled' }], tx)` is called with no value present,
**Then** it throws (or rejects) and the slot is unchanged;
**And** `applySlotUpdates([{ slotId, status: 'filled', value: <v> }], tx)` sets the slot `filled`
with that value;
**And** `applySlotUpdates([{ slotId, status: 'defaulted' }], tx)` (a non-filled transition) applies
without a value.

### AC-4 — completeAndPop completes and activates the next objective
**Given** a thread with an active objective (top) and a suspended one beneath it,
**When** `completeAndPop(activeId, tx)` is called,
**Then** the active becomes `complete` with a `completed_at`, the highest-position suspended sibling
becomes `active`, and it is returned;
**And** with no suspended sibling the method returns `null` and leaves the stack empty.

### AC-5 — isComplete counts required non-terminal slots
**Given** an objective whose required slots are all `filled` or `defaulted` but with an unfilled
*optional* slot remaining,
**When** `isComplete(objectiveId)` is called,
**Then** it returns `true` (optional slots don't block completion);
**And** with any required slot still `unasked`/`asked`, it returns `false`.

### AC-6 — one household per user; addMember idempotent
**Given** a household and a user already linked to it,
**When** `addMember({ householdId, userId })` is called again with the same user,
**Then** it is a no-op (no duplicate row, no error);
**And** `createHousehold` returns a household owned by the given `ownerUserId`.

### AC-7 — household preferences read-merge-write
**Given** no `household_preferences` row for a household,
**When** `getPreferences` is called,
**Then** it returns the defaults;
**And** after `savePreferences(householdId, { cookDaysCount: 4 })` then
`savePreferences(householdId, { weeklyBudgetCents: 15000 })`, `getPreferences` reflects **both**
(the second patch merges, not overwrites, untouched fields), and `updated_at` advanced.

## Test Cases

Offline Vitest in `test/**`, each via `migratedFileDb()`; seed prerequisite `users`/`threads`/
`objectives` rows directly. No network. As few tests as cover the paths.

### Test Case 1: loadActive — unfilled-only + null (AC-1)
**Preconditions:** a thread, one active objective, four slots (`unasked`, `asked`, `filled`, `defaulted`).
**Steps:** call `loadActive(threadId)`; then call it on a thread with no objective.
**Expected Outcomes:** returns the objective + the three non-`filled` slots; second call returns `null`.

### Test Case 2: pushObjective top/bottom ordering + invariant (AC-2)
**Preconditions:** a thread with an active objective at `stack_position = 1`.
**Steps:** (a) push `top`; (b) push `bottom`; (c) fresh thread, push (any position).
**Expected Outcomes:** (a) prior→suspended, new active at position 2, no constraint error;
(b) new suspended at position 0, prior top still active; (c) new objective is active.

### Test Case 3: applySlotUpdates invariant (AC-3)
**Preconditions:** an objective with one slot `asked`, `value = null`.
**Steps (in a tx):** (a) fill with no value; (b) fill with a value; (c) mark another slot `defaulted`.
**Expected Outcomes:** (a) throws, slot unchanged; (b) slot `filled` with the value; (c) slot `defaulted`.

### Test Case 4: completeAndPop activates next / empties stack (AC-4)
**Preconditions:** a thread with active (pos 2) + suspended (pos 1) objectives.
**Steps:** (a) `completeAndPop(activeId, tx)`; (b) in a single-objective setup, `completeAndPop`.
**Expected Outcomes:** (a) active→complete (completed_at set), suspended→active, returned;
(b) returns `null`, no active objective remains.

### Test Case 5: isComplete (AC-5)
**Preconditions:** an objective with required slots all terminal + one optional `unasked`; and a
variant with a required slot `asked`.
**Steps:** call `isComplete` on each.
**Expected Outcomes:** `true` for the first, `false` for the second.

### Test Case 6: household create + idempotent addMember (AC-6)
**Preconditions:** two `users`.
**Steps:** `createHousehold({ ownerUserId: A })`; `addMember(A)`; `addMember(A)` again; `addMember(B)`;
`loadMembers`.
**Expected Outcomes:** household owned by A; `household_members` has exactly A and B (second A a
no-op); `loadMembers` returns A and B with their `users.name`/`imessage_handle`.

### Test Case 7: household preferences merge (AC-7)
**Preconditions:** a household, no preferences row.
**Steps:** `getPreferences` (defaults); `savePreferences({ cookDaysCount: 4 })`;
`savePreferences({ weeklyBudgetCents: 15000 })`; `getPreferences`.
**Expected Outcomes:** first read = defaults; final read has `cookDaysCount = 4` **and**
`weeklyBudgetCents = 15000`; `updated_at` advanced between writes.

## Test Run

_To be completed by the implementer. Run `npm test` and paste, per test case, the command,
output, and pass/fail. Confirm the full offline suite (incl. WI-01 + increment-1) stays green._

## Deployment Strategy

Pure application code on top of WI-01's additive schema — no migration, no runtime wiring yet
(the Chef consumes these in a later work item). Ships behind the existing build; nothing calls the
new classes in production until the Chef is wired, so there is no runtime-behaviour change to
deploy. Rollback is a code revert with no data implications (the tables stay).

## Production Verification

Because nothing invokes these repositories in production until the Chef lands, production
verification is deferred to the Chef work item's end-to-end acceptance test (the reasoning doc's
manual iMessage onboarding run, which exercises `pushObjective` → `applySlotUpdates` →
`completeAndPop` and the household writes through real turns). This work item's guarantee is the
offline suite.

### Production Verification 1 (deferred): repositories exercised by a live onboarding turn
**Preconditions:** the Chef wired (later WI); a real iMessage thread reaches "same kitchen".
**Steps:** onboard a household end-to-end on a dedicated iMessage line.
**Expected Outcomes:** a `households` row + `household_members` per participant + a
`household_preferences` row with the collected values; the `objectives` row completes and pops;
all required slots terminal.

## Production Verification Run

_Deferred to the Chef work item — see above. No standalone prod verification for WI-02._
