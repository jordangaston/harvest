# WI-03 — Command tools (the chef's Mastra tool layer)

## Background

The chef agent changes Harvest's data only through **commands** — named, validated tool calls
the reasoning LLM emits (design: [`01-agent-architecture.md`](../../imessage-onboarding/01-agent-architecture.md)
§ Commands, and [`increment-2-reasoning-and-onboarding.md`](../../imessage-onboarding/increment-2-reasoning-and-onboarding.md)
§ Operations). The model never writes to the database directly; every change routes through a
typed chokepoint that validates arguments, normalizes them against the catalog, refuses unsafe
input (an unconfirmed allergen), and reports honestly what landed vs. what was rejected. That
single constraint buys the four properties the design leans on: safety (allergens can't be
written unconfirmed), correctness (only catalog-valid enums land), auditability (the committed
rows are the command log), and testability (feed a command a payload and assert the result — no
LLM needed).

This work item builds that tool layer as three Mastra tools (`createTool` from `@mastra/core`)
under `server/src/chef/tools/`. Each wraps an existing Harvest service **in-process** (no HTTP,
no tokens — the agent holds no credentials; design D-10 / R5) scoped to the thread's household.
The tools are **deterministic given their inputs** — no LLM inside them — so this whole work item
is unit-testable offline, which is the point: it isolates the legality and normalization
guarantees from the correctness of any objective's prompt.

Depends on WI-01 (schema: `households`, `household_members`, `household_preferences`, `objectives`,
`slots`) and WI-02 (repos: `ObjectiveStore`, household repos). The Mastra harness (`@mastra/core`)
is added in this increment (D2-4). Branch `jordangaston/imessage-increment-2`.

## Objective

Ship three command tools, each with (a) a Zod `inputSchema` reusing the existing preference
schemas where possible, (b) a `canRun(state)` precondition that is a **pure function of the chef
state**, and (c) an `execute` that calls a Harvest service in-process scoped to the thread's
household and returns a `SaveResult`:

```ts
type SaveResult = {
  saved: Record<string, unknown>;              // what landed, post-normalization
  rejected: Array<{
    input: string;                             // what the model tried to save
    reason: string;                            // "no catalog match" | "allergen not confirmed" | …
    closest?: string[];                        // nearest valid values, when they exist
  }>;
};
```

| Tool | Args | `canRun(state)` | Receiver (in-process) |
|---|---|---|---|
| `save_household_profile` | `{ patch }` ⊂ `household_preferences` fields | **always** (`() => true`) | `PreferenceService` — household rows, read-merge-write |
| `save_member_profile` | `{ member_user_id, patch }`; allergen entries require `confirmed: true` | **member exists in the thread's household** | `PreferenceService` — that member's per-user rows |
| `search_catalog` | `{ kind: 'taste' \| 'store' \| 'equipment' \| 'diet' \| 'allergen', query }` | **always** | `TasteOptionsService` + the enum tuples in `schema.ts` / `diet-rules.ts` |

The design invariant every tool upholds: **all command runners are idempotent read-merge-writes**
(scalars last-writer-wins, sets union), and **enum-or-nothing** — a value the catalog doesn't
return is rejected, never guessed, never written raw.

### The chef state `canRun` reads

`canRun` and each `execute`'s defensive re-check are pure functions of a `ChefState` slice. For
this work item that slice is:

```ts
type ChefState = {
  householdId: string;                         // the thread's household (null before "same kitchen")
  members: Array<{ userId: string }>;          // the household's members (WI-01/02 load)
  args?: unknown;                              // the tool's parsed args, when re-checking defensively
};
```

`[ASSUMPTION: ChefState is assembled by prepareBriefing (WI-06) and threaded to the tools via
Mastra's request/runtime context, per 01 § reasoning-agent code. WI-03 only depends on the two
fields above (householdId, members) and defines canRun against them; the full state shape is
WI-06's to finalize.]`

## Acceptance Criteria

### AC-1 — Each tool's `canRun` is a tested pure function of state

- **Given** a `ChefState`, **when** `save_household_profile.canRun(state)` is called, **then** it
  returns `true` unconditionally.
- **Given** a `ChefState` and args naming a `member_user_id`, **when**
  `save_member_profile.canRun({ ...state, args })` is called, **then** it returns `true` iff a
  member with that `userId` is in `state.members`, else `false`.
- **Given** a `ChefState`, **when** `search_catalog.canRun(state)` is called, **then** it returns
  `true` unconditionally.
- **And** `canRun` performs no I/O — it reads only the passed state (verifiable by calling it with
  no database wired).

### AC-2 — `execute` returns a `SaveResult` with partial acceptance

- **Given** a payload where some values are catalog-valid and some are not, **when** `execute`
  runs, **then** the valid values appear in `saved` (post-normalization) and each invalid value
  appears in `rejected` with a `reason` and, where a near match exists, a `closest[]` array.
- **Given** `save_household_profile({ patch: { grocery_stores: ["kroger", "piggly wiggly's little
  cousin"] } })`, **when** it runs, **then** the result is
  `{ saved: { grocery_stores: ["kroger"] }, rejected: [{ input: "piggly wiggly's little cousin",
  reason: "no catalog match", closest: ["piggly_wiggly"] }] }`.

### AC-3 — The allergen confirmed gate

- **Given** `save_member_profile` with an allergen entry that lacks `confirmed: true`, **when** it
  runs, **then** the allergen is **not** written and it appears in `rejected` with
  `reason: "allergen not confirmed"`.
- **Given** the same allergen entry **with** `confirmed: true` and a valid severity, **when** it
  runs, **then** it is written (set-union with any existing allergens) and appears in `saved`.
- **And** `save_household_profile` never accepts allergens at all (they are member-scoped) — an
  allergen key in a household patch is rejected/ignored by the schema.

### AC-4 — Enum-or-nothing writes (normalization + coercion)

- **Given** each of these inputs, **when** the corresponding tool runs, **then** the normalized
  value lands (or is rejected with `closest`):

  | Input | Tool / field | Normalizes to |
  |---|---|---|
  | `"instant pot"` | equipment | `pressure_cooker` |
  | `"shrimp"` | member allergen | `crustacean_shellfish` |
  | `"$150ish"` | `weekly_budget_cents` | `15000` |
  | `"Kroger"` | `grocery_stores` | `kroger` |
  | `"veggie"` | member diet | `vegetarian` `[ASSUMPTION: search_catalog grounds diets against DIET_RULES ids in src/diet/diet-rules.ts (vegetarian, vegan, pescatarian, dairy_free, keto, …); there is no closed diet enum in schema.ts, so the tool coerces the model's word into a DIET_RULES id and rejects an unknown one with closest[].]` |
  | `"piggly wiggly's little cousin"` | `grocery_stores` | **rejected**, `closest: ["piggly_wiggly"]` |

- **And** a value that matches no catalog entry and has no near match is rejected with an empty or
  absent `closest`, never written raw.

### AC-5 — `save_member_profile` refuses a write for an absent member (defensive `execute`)

- **Given** a `member_user_id` not in the household, **when** `save_member_profile.execute` runs
  (bypassing `canRun`, simulating a bad model turn or a search-surfaced tool), **then** it
  re-checks `canRun` and returns `{ saved: {}, rejected: [{ input: <member_user_id>,
  reason: "member does not exist yet" }] }` — no write occurs.

### AC-6 — Idempotent read-merge-write

- **Given** the same valid `save_*` payload run twice, **when** both runs complete, **then** the
  resulting rows are identical to a single run (scalars last-writer-wins, allergen/diet/equipment
  sets union rather than duplicate) — verified by re-running and asserting DB state is unchanged.

### AC-7 — `search_catalog` returns grounding candidates, writes nothing

- **Given** `search_catalog({ kind, query })`, **when** it runs, **then** it returns candidate
  `{ value, label }` entries from the catalog for `kind` (taste → `TasteOptionsService.options()`;
  store/equipment/diet/allergen → the code tuples) ranked by match to `query`, and performs **no
  write**. An empty query returns the full catalog for that `kind`.

## Test Cases

All tests are Vitest unit tests, offline (`tests/helpers` local Postgres for the two `save_*`
tools' service calls per `server/CLAUDE.md`; `search_catalog` needs only the seeded catalog).
No network, no LLM.

### Test Case 1: `canRun` pure functions (AC-1)

**Preconditions:** A `ChefState` fixture with `householdId: "h1"`, `members: [{ userId: "u-sam" }]`.
No database wired.

**Steps:**
1. Call `save_household_profile.canRun(state)` and `search_catalog.canRun(state)`.
2. Call `save_member_profile.canRun({ ...state, args: { member_user_id: "u-sam" } })`.
3. Call `save_member_profile.canRun({ ...state, args: { member_user_id: "u-ghost" } })`.

**Expected Outcomes:**
1. Both return `true`.
2. Returns `true`.
3. Returns `false`. No exception, no I/O attempted.

### Test Case 2: partial-accept SaveResult for stores (AC-2)

**Preconditions:** A seeded household `h1` with an empty `household_preferences` row.

**Steps:**
1. `save_household_profile.execute({ patch: { grocery_stores: ["kroger", "piggly wiggly's little cousin"] } }, ctx(h1))`.

**Expected Outcomes:**
- Returns `{ saved: { grocery_stores: ["kroger"] }, rejected: [{ input: "piggly wiggly's little cousin", reason: "no catalog match", closest: ["piggly_wiggly"] }] }`.
- `household_preferences.grocery_stores` for `h1` is `["kroger"]`.

### Test Case 3: allergen confirmed gate, both directions (AC-3)

**Preconditions:** Household `h1` with member `u-sam`.

**Steps:**
1. `save_member_profile.execute({ member_user_id: "u-sam", patch: { allergens: [{ allergen: "peanut", severity: "severe" }] } }, ctx(h1))` — **no** `confirmed`.
2. `save_member_profile.execute({ member_user_id: "u-sam", patch: { allergens: [{ allergen: "peanut", severity: "severe", confirmed: true }] } }, ctx(h1))`.

**Expected Outcomes:**
1. `rejected` contains `{ input: "peanut", reason: "allergen not confirmed" }`; no `user_allergens` row for `u-sam`.
2. `saved.allergens` includes `peanut`; a `user_allergens` row `(u-sam, peanut, severe)` exists.

### Test Case 4: normalization / coercion table (AC-4)

**Preconditions:** Household `h1` with member `u-sam`; seeded catalog.

**Steps:** run each row of the AC-4 table through its tool.

**Expected Outcomes:** each normalized value matches the "normalizes to" column; the two
no-match cases land in `rejected` (`piggly wiggly's little cousin` with `closest: ["piggly_wiggly"]`,
an unknown diet with a `closest[]` of nearest `DIET_RULES` ids).

### Test Case 5: absent-member defensive refusal (AC-5)

**Preconditions:** Household `h1` with member `u-sam` only.

**Steps:**
1. `save_member_profile.execute({ member_user_id: "u-ghost", patch: { diets: [{ dietId: "vegan", strictness: "strict" }] } }, ctx(h1))`.

**Expected Outcomes:** `{ saved: {}, rejected: [{ input: "u-ghost", reason: "member does not exist yet" }] }`; no `user_diets` row written.

### Test Case 6: idempotent re-run (AC-6)

**Preconditions:** Household `h1`, member `u-sam`.

**Steps:**
1. `save_member_profile.execute({ member_user_id: "u-sam", patch: { allergens: [{ allergen: "peanut", severity: "severe", confirmed: true }] } }, ctx(h1))` — twice.
2. Snapshot `user_allergens` for `u-sam` after each.

**Expected Outcomes:** exactly one `(u-sam, peanut, severe)` row after both runs (set-union, no duplicate); the second `SaveResult.saved` equals the first.

### Test Case 7: `search_catalog` grounds, writes nothing (AC-7)

**Preconditions:** Seeded catalog.

**Steps:**
1. `search_catalog.execute({ kind: "store", query: "krog" }, ctx(h1))`.
2. `search_catalog.execute({ kind: "diet", query: "veggie" }, ctx(h1))`.
3. `search_catalog.execute({ kind: "taste", query: "" }, ctx(h1))`.
4. After each, assert no rows changed in `household_preferences` / `user_*`.

**Expected Outcomes:**
1. Returns candidates including `{ value: "kroger", … }` ranked first.
2. Returns `{ value: "vegetarian", … }` among the top matches.
3. Returns the full taste catalog.
4. No write occurred in any call.

## Test Run

`npx vitest run test/chef-tools.test.ts` — 9 passed (0 failed). Covers all seven cases:
canRun pure fns (TC-1), store partial-accept (TC-2), allergen confirmed gate both directions
(TC-3), the coercion table incl. instant pot / shrimp / $150ish / veggie (TC-4), absent-member
defensive refusal (TC-5), idempotent set-union re-run (TC-6), and `search_catalog` grounding
with no write (TC-7). Full suite: 463 passed / 1 skipped, no regressions.

Notes / deviations from the sketch:
- `@mastra/core@1.63.2`. Verified `createTool({ id, description, inputSchema, execute })` with the
  v1 two-arg `execute(inputData, context)` signature (import from `@mastra/core/tools`).
- Mastra has no `canRun` concept, so each tool exports `canRun` as a plain pure fn beside the
  `createTool` object; the reasoning layer (WI-06) checks it before dispatching.
- `save_member_profile` calls `PreferenceRepository.savePreferences`, but that method is a full
  rebuild of the editable subset (delete-and-reinsert), not a partial patch. To honour the
  set-union / read-merge-write invariant, the tool reads current prefs, unions the new
  allergen/diet/equipment entries in, and writes the full merged object back — so the receiver's
  rebuild is a no-op replay of the unchanged sets plus the additions.

## Deployment Strategy

Pure code addition — three new tool modules under `server/src/chef/tools/`, no schema change of
their own (they write to WI-01's tables). The tools are inert until WI-06's Chef wires them into
an objective's resident set and an inbound thread reaches "same kitchen"; deploying them ahead of
that is a no-op. Ship behind the same additive migration sequence WI-01 owns; the tools reference
those tables but add none. Rollback is a plain code revert — no data migration to undo.

## Production Verification

Because the tools carry no LLM and are deterministic, production verification is behavioral
observation once WI-07/08 drive them on a real thread: the `chef_tool_rejects_total{tool}` metric
(design § Monitoring) and the committed rows.

### Production Verification 1: a real save lands and normalizes

**Preconditions:** A dedicated Photon line, an onboarded-in-progress thread with a household
(WI-07 flow reached "same kitchen").

**Steps:**
1. Text a household-scoped answer that requires coercion (e.g. "we shop at Kroger, budget's $150ish").
2. Read `household_preferences` for the thread's household.

**Expected Outcomes:** `grocery_stores` contains `kroger`, `weekly_budget_cents` is `15000`; a
`chef_tool_rejects_total` increment only if an unmatched value was tried.

### Production Verification 2: an unconfirmed allergen is refused end-to-end

**Preconditions:** Same thread, a member identified.

**Steps:**
1. Text "Sam's allergic to peanuts" (no severity).
2. Confirm no `user_allergens` row is written until the severity + confirmation exchange completes.

**Expected Outcomes:** the allergen row appears only after the confirmed write; a
`chef_tool_rejects_total{tool="save_member_profile"}` bump on the first, unconfirmed attempt.

## Production Verification Run

[To be filled after the WI-07/08 acceptance run on the dedicated line.]
