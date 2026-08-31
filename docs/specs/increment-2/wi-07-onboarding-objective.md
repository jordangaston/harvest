# WI-07 — The onboarding `ObjectiveDefinition`

## Background

Onboarding is the first program the chef agent runs — and the most demanding, because it must
gather a household's whole cooking profile through natural group conversation
([`02-onboarding.md`](../../imessage-onboarding/02-onboarding.md)). The chef machinery
(reasoning/response split, the objective stack, the slot scoreboard, the command tools) is built
in WI-03/WI-06; **onboarding is a declaration on top of it, not new machinery** — an
`ObjectiveDefinition` that names the slots to fill, the tools it may use, and condition-gated
guidance, plus the "same kitchen" household-creation flow and a computable completion predicate.

The design refinement this work item enforces (design
[`01`](../../imessage-onboarding/01-agent-architecture.md) § "Is this still the state of the art?"):
**an objective declares requirements and guidance — never a conversational path.** No step
sequence, no transition graph, no step cursor. The model self-orchestrates the dialogue inside the
objective; the definition contributes *what is needed*, *what "done" means*, and *which tools
exist*. Guidance is written as condition → guidance pairs (Parlant-style), not one static block.

Depends on WI-03 (the tools: `save_household_profile`, `save_member_profile`, `search_catalog`)
and WI-06 (the Chef, `prepareBriefing`, the reasoning/response agents, `ObjectiveStore`). The
`ObjectiveDefinition` **definition itself** — its slot list, tool set, and completion predicate —
is unit-testable offline; its *conversational behavior* (the real prompt driving real tools) is
exercised by the WI-08 golden-transcript eval harness, not here. Branch
`jordangaston/imessage-increment-2`.

## Objective

Register the onboarding objective in `server/src/chef/objectives/onboarding.ts` and the "same
kitchen" identity flow that turns a room into a household, such that:

1. **The definition** names its household-scoped and member-scoped slots (per the design's
   onboarding block, reproduced below), its three tools, and its condition-gated `instructions`.
2. **Seeding the objective** onto a new thread creates exactly the right `objectives` row +
   `slots` rows (WI-01 tables via WI-06's `ObjectiveStore`).
3. **The "same kitchen" turn** (F-01 identity block) creates a `users` row per participant keyed
   by `imessage_handle`, a `households` row with the initiator as `owner_user_id`, a
   `household_members` link per identified member, and stamps `threads.household_id`.
4. **Completion is a computable predicate** — every *required* slot `filled` or `defaulted` — that,
   when true, triggers the close (confetti + drop-a-recipe invite + first-menu promise) and pops
   the objective off the stack.

### The definition (design source of truth)

Per [`increment-2-reasoning-and-onboarding.md`](../../imessage-onboarding/increment-2-reasoning-and-onboarding.md)
§ "The onboarding objective":

```ts
export const onboarding: ObjectiveDefinition = {
  id: "onboarding",
  trigger: "message",                          // first inbound message on a new thread
  tools: ["save_household_profile", "save_member_profile", "search_catalog"],
  slots: [
    // household-scoped                              // member-scoped (one per member)
    slot("household.same_household", req),           mslot("name", req),
    slot("household.goals"),                         mslot("allergens", req),   // + severity, confirmed
    slot("household.grocery_stores", req),           mslot("diets"),            // + strictness
    slot("household.grocery_shopping_day"),          mslot("likes"),
    slot("household.weekly_budget_cents"),           mslot("dislikes"),
    slot("household.household_size", req),           mslot("skill_level"),
    slot("household.weekly_meals", req),
    slot("household.cook_days_count", req),
    slot("household.time_by_meal"),
    slot("household.eats_leftovers"),
    slot("household.owned_equipment"),
  ],
  instructions: CONDITION_GATED_GUIDANCE,          // condition → guidance pairs
};
```

`req` marks a required slot; `slot()` builds a household-scoped slot spec, `mslot()` a
member-scoped one (one slot row is instantiated per member as members are identified). The
**field map** (conversation step → which tool writes what) is specified in
[`02-onboarding.md`](../../imessage-onboarding/02-onboarding.md#field-map--conversation-step--write) —
cited, not re-pasted here.

`[ASSUMPTION: the slot()/mslot() spec helpers and the ObjectiveDefinition / SlotSpec types are
defined by WI-06 (the framework). WI-07 consumes them to author the onboarding definition; if
WI-06 names them differently the definition adapts, but the slot list, tool set, scopes, and
required-flags above are WI-07's contract.]`

### Condition-gated guidance

`instructions` is an array of `{ condition, guidance }` pairs (not a static block), activated on
precise conditions. At minimum:

| Condition | Guidance |
|---|---|
| an allergen was named without a severity | ask mild/moderate/severe, then write only with `confirmed: true` |
| a like is broad ("anything with chicken") | drill down (fajitas / creamy pasta / stir-fry?) before saving via `search_catalog` grounding |
| a store/diet/equipment answer is off-catalog | acknowledge and drop it — never write a value the tools didn't return |
| a required slot is unanswered after the room moved on | one reworded follow-up, then a stated default (the safety-asymmetry voice for allergens: "I'll plan as if Sam has no allergies until he says otherwise") |

The full reference script, group mechanics (addressing, `sender.address` attribution, corrections,
follow-ups, conflicts, safety asymmetry), and proxy-answer semantics are specified in
[`02-onboarding.md`](../../imessage-onboarding/02-onboarding.md#group-mechanics) and its
Concurrency & Proxy Semantics section — cited, unchanged. `[ASSUMPTION: 02's set_reminder tool
and SMS/RCS per-member degradation are deferred this increment (increment-2 scope table: reminder
"lean include", SMS/RCS "all iMessage for now"); the follow-up guidance is authored but its
durable timer is WI-06/reminders' to wire — WI-07 states the default-after-silence behavior, not
the timer.]`

## Acceptance Criteria

### AC-1 — Seeding the objective creates the right slots

- **Given** a new thread and the onboarding definition, **when** the objective is seeded (WI-06's
  `ObjectiveStore.push`), **then** one `objectives` row (`definition = "onboarding"`,
  `status = "active"`) and one `slots` row per household-scoped slot are created, each with the
  correct `key`, `scope = "household"`, `required` flag, and `status = "unasked"`.
- **And** member-scoped slots are **not** instantiated until a member exists (they are per-member).

### AC-2 — The required-slot set matches the definition

- **Given** the seeded objective, **when** the required household slots are listed, **then** they
  are exactly: `same_household`, `grocery_stores`, `household_size`, `weekly_meals`,
  `cook_days_count`; and the required member slots (per identified member) are `name` and
  `allergens`. All others are optional.

### AC-3 — The tool set is exactly the three onboarding tools

- **Given** the onboarding definition, **when** its `tools` are resolved, **then** they are
  `["save_household_profile", "save_member_profile", "search_catalog"]` and nothing else. (Legality
  per tool stays `canRun`'s job — WI-03; residency is focus, not a boundary — design § Commands.)

### AC-4 — The "same kitchen" turn creates household, members, and stamps the thread

- **Given** a thread whose room answers "same kitchen" with two identified participants (Priya,
  Sam), **when** the identity flow runs, **then**:
  - a `users` row exists per participant, keyed by `imessage_handle`, `name` filled as given
    (nullable when not yet given);
  - a `households` row exists with `owner_user_id` = the initiator;
  - a `household_members` link exists per **identified** member;
  - `threads.household_id` is stamped, and `household.same_household` slot is `filled`.
- **And** a member who has **not** been identified yet blocks only their own membership row and
  writes about them — everything household-scoped and everything about an identified member writes
  through immediately (the no-mid-flow-sync rule,
  [`02`](../../imessage-onboarding/02-onboarding.md#no-mid-flow-synchronization-one-soft-gate-at-the-end)).

### AC-5 — Completion is computable and triggers the close

- **Given** an onboarding instance, **when** every *required* slot (household + each member's) is
  `filled` or `defaulted`, **then** `isComplete(instance)` returns `true`.
- **Given** any required slot still `unasked`/`asked`, **then** `isComplete` returns `false`.
- **And** when `isComplete` flips true, the turn emits the close intents (confetti +
  drop-a-recipe invite + first-menu promise as `ReplyPlan.intents`) and the objective is marked
  `complete` and popped (WI-06's `ObjectiveStore.pop`).

### AC-6 — Per-member slot instantiation

- **Given** the household exists and a new member is identified mid-flow, **when** their membership
  is created, **then** the member-scoped slot rows (`name`, `allergens` required; `diets`, `likes`,
  `dislikes`, `skill_level` optional) are instantiated for that member with `scope = "member"` and
  the member's `member_user_id`.

### AC-7 — The definition scripts no conversational path

- **Given** the onboarding definition, **when** it is inspected, **then** it contains **no** ordered
  step list, transition graph, or step cursor — only slots, tools, and condition-gated guidance
  (design refinement: an objective that grows a path graph is the LangGraph anti-pattern).

## Test Cases

Unit tests (Vitest, offline, `tests/helpers` local Postgres per `server/CLAUDE.md`) exercise the
**definition and the identity flow** with the reasoning/response models stubbed. The *conversational*
behavior (real prompt + real tools) is WI-08's golden-transcript harness — out of scope here.

### Test Case 1: seeding creates household slots (AC-1, AC-2)

**Preconditions:** A new thread row, no objective yet.

**Steps:**
1. Seed the onboarding objective via `ObjectiveStore.push(threadId, onboarding)`.
2. Query the created `objectives` and `slots` rows.

**Expected Outcomes:**
- One `objectives` row (`definition = "onboarding"`, `status = "active"`).
- One `slots` row per household-scoped slot, correct `key`/`required`/`status = "unasked"`,
  `scope = "household"`.
- The required set equals `{ same_household, grocery_stores, household_size, weekly_meals, cook_days_count }`.
- No member-scoped slot rows yet.

### Test Case 2: tool set (AC-3, AC-7)

**Preconditions:** the imported `onboarding` definition.

**Steps:** read `onboarding.tools`; assert no `steps`/`path`/`transitions` field exists on the object.

**Expected Outcomes:** `tools` deep-equals `["save_household_profile", "save_member_profile",
"search_catalog"]`; the definition has no path/step/cursor field.

### Test Case 3: "same kitchen" identity flow (AC-4)

**Preconditions:** A thread with two inbound `sender.address` handles (Priya = initiator, Sam),
both names given.

**Steps:**
1. Run the identity flow for the "same kitchen" answer.
2. Query `users`, `households`, `household_members`, and the thread row.

**Expected Outcomes:**
- Two `users` rows keyed by handle, names set.
- One `households` row, `owner_user_id` = Priya's user id.
- Two `household_members` links.
- `threads.household_id` stamped; `household.same_household` slot `filled`.

### Test Case 4: unidentified member blocks only themselves (AC-4)

**Preconditions:** "same kitchen" answered; Priya identified, Sam not yet named.

**Steps:**
1. Run the identity flow.
2. Write a household-scoped answer (e.g. `grocery_stores`) and a Priya-scoped answer.

**Expected Outcomes:**
- Household row + Priya's membership exist; the household-scoped and Priya writes land.
- No membership row for Sam; no member slots instantiated for Sam.

### Test Case 5: per-member slot instantiation (AC-6)

**Preconditions:** Household exists; Sam is identified mid-flow.

**Steps:** create Sam's membership; query `slots` for Sam.

**Expected Outcomes:** member-scoped slot rows for Sam exist — `name`, `allergens` required;
`diets`, `likes`, `dislikes`, `skill_level` optional — each `scope = "member"`,
`member_user_id = Sam`.

### Test Case 6: completion predicate + close (AC-5)

**Preconditions:** An instance where all required slots are `filled` except one member's
`allergens`, which is `asked`.

**Steps:**
1. Assert `isComplete` is `false`.
2. Default the outstanding `allergens` slot to `defaulted`.
3. Assert `isComplete` is `true`; run the turn and inspect the emitted `ReplyPlan` + objective status.

**Expected Outcomes:**
- Step 1: `false`. Step 3: `true`; the `ReplyPlan.intents` carry the confetti close +
  drop-a-recipe invite + first-menu promise; the `objectives` row is `complete` and popped.

## Test Run

[To be filled by the implementer: `pnpm vitest run tests/chef/objectives/` output, per-case pass/fail.]

## Deployment Strategy

Code addition — one objective module plus the identity flow (which uses WI-01's `households` /
`household_members` / `users.imessage_handle` and stamps `threads.household_id`). Inert until an
inbound thread reaches "same kitchen", so it deploys dormant behind WI-01's additive migrations.
Rollback is a code revert; the additive tables and the objective/slot rows remain and let a
restarted system resume mid-conversation (design § Deployment / Rollback). No data migration
belongs to WI-07 (the single-member-household backfill is WI-01's).

## Production Verification

The behavioral proof is the WI-08 acceptance run — a household onboarded end to end on a
dedicated Photon line — but WI-07's own contract is verifiable on that run by DB inspection.

### Production Verification 1: a real "same kitchen" forms a household

**Preconditions:** A dedicated Photon line; two real iMessage devices in one thread.

**Steps:**
1. Text the number; answer names and "same kitchen".
2. Inspect `users`, `households`, `household_members`, `threads.household_id` for that thread.

**Expected Outcomes:** two users keyed by handle, one household (initiator = owner), two
memberships, `threads.household_id` stamped.

### Production Verification 2: completion fires the close

**Preconditions:** The same thread, driven through every required slot.

**Steps:**
1. Answer every required household + member slot (or let a follow-up default one).
2. Observe the reply and the `objectives` row.

**Expected Outcomes:** the confetti close + drop-a-recipe invite + first-menu promise are
delivered; the onboarding `objectives` row is `complete` and popped;
`chef_onboarding_completed_total` increments (design § Monitoring).

## Production Verification Run

[To be filled after the WI-08 acceptance run on the dedicated line.]
