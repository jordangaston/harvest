# WI-01 — Increment-2 schema & Zod models: households, preferences, objectives, slots

## Background

Increment 1 shipped the iMessage substrate — the webhook, the `message_guid` doorbell,
the per-thread Redlock lock, the `sent_at` outbox gate, `ThreadRepository`, and a stub
Chef — with `threads` owned by a single user (`threads.owner_user_id`). Increment 2 replaces
the stub with the real reasoning layer and makes the **household** first-class. That reasoning
layer keeps its durable memory in Turso, because a serverless turn holds nothing in process
between messages (`increment-2-reasoning-and-onboarding.md` § "Durable across machines"): the
objective stack, the slot scoreboard, the household, and the household's preferences all live
in tables that each turn reloads and commits.

This work item is the **foundation** the rest of increment 2 builds on: the five new tables
(`households`, `household_members`, `household_preferences`, `objectives`, `slots`), their
Drizzle definitions in `src/schema.ts`, the generated migration, and the Zod domain models the
repositories (WI-02) parse rows into. It ships **only schema + models** — no repositories, no
services, no Chef wiring. Those depend on this and land in later work items.

Two design decisions from the reasoning doc shape the schema and must be preserved:

- **D2-6 — objectives & slots are tables, not a JSON blob on the thread.** This buys lock-free
  push (adding an objective is an `INSERT`, never a lock-held read-modify-write of a shared blob)
  and tight context (the briefing loads only unfilled slots via `WHERE status != 'filled'`, and
  "are we done?" is a `COUNT`).
- **The one-active-objective invariant is DB-enforced** via a partial unique index
  `objectives_one_active_per_thread` on `(thread_id) WHERE status = 'active'` — at most one active
  objective per thread. libSQL/Turso (SQLite) supports partial indexes (`CREATE INDEX ... WHERE`).

House rules that constrain this work (`server/CLAUDE.md`, memory `store-reference-data-granular`,
memory `domain-modeling-and-solid`):
- **All PKs are `uuid` text** via the `uuidPk()` helper (`crypto.randomUUID`).
- **Migrations only** — `drizzle-kit generate` then `drizzle-kit migrate`; never hand-author DDL,
  never apply DDL directly. (See the ASSUMPTION on partial indexes below.)
- **`household_members` is a pure link** — name lives on `users.name`, handle on
  `users.imessage_handle`; the link never duplicates them. One household per user in v1.
- **No `users.service` column and no channel column** — everything is iMessage for now.
- Each entity is a **Zod schema** distinct from the Drizzle table; repositories `parse` rows into
  the model at the boundary.

[ASSUMPTION: `drizzle-kit`'s SQLite/Turso generator does **not** emit a partial index — it drops
the `WHERE status = 'active'` predicate and would generate a plain unique index on `(thread_id)`,
which is wrong (it would reject a *second objective of any status*, not a second *active* one). So
after `npm run db:generate`, the generated migration file must be **edited by hand to replace the
generated `objectives_one_active_per_thread` unique-index statement with the partial-index form**
`CREATE UNIQUE INDEX \`objectives_one_active_per_thread\` ON \`objectives\` (\`thread_id\`) WHERE \`status\` = 'active';`.
This is the sanctioned exception to "never hand-write DDL" — we edit generator output, we don't
author a migration from scratch. Drizzle's schema builder cannot express a partial unique index in
the table definition, so the index is *not* declared in `src/schema.ts`; it exists only in the
migration. Confirm at generate time whether the installed drizzle-kit version has since gained
`.where()` support on `uniqueIndex`; if so, declare it in-schema and drop the hand-edit.]

## Objective

Add the five increment-2 tables to `src/schema.ts` with correct columns, foreign keys, indexes,
and the partial-unique active-objective index; generate the migration (next number is `0024`) and
hand-correct the partial index; and add the Zod domain models each table round-trips through. The
migration applies cleanly through `migratedFileDb()`, the partial index rejects a second active
objective per thread, and every table round-trips through its model.

## Acceptance Criteria

### AC-1 — Tables exist with the specified shape
**Given** the increment-2 schema is defined in `src/schema.ts` and migration `0024` is applied,
**When** the migrator runs against a fresh `file:` libSQL db,
**Then** the tables `households`, `household_members`, `household_preferences`, `objectives`,
and `slots` exist with the columns, types, nullability, defaults, foreign keys (with the stated
cascade behaviour), and indexes defined below, and the migration completes without error.

### AC-2 — One active objective per thread is DB-enforced
**Given** an applied schema with a thread and one `objectives` row at `status = 'active'`,
**When** a second `objectives` row for the same `thread_id` is inserted with `status = 'active'`,
**Then** the insert fails with a unique-constraint violation;
**And** inserting a second row for the same thread at `status = 'suspended'` (or `'complete'`)
succeeds — the constraint gates only *active* rows.

### AC-3 — The slot uniqueness + status indexes exist and behave
**Given** an applied schema with an `objectives` row,
**When** two `slots` rows are inserted with the same `(objective_id, key, member_user_id)`,
**Then** the second fails the unique index `slots_objective_key_member_uidx`;
**And** two household-scoped slots with the same `key` but distinct `member_user_id` values (one
`NULL`, one set) coexist [ASSUMPTION: SQLite treats `NULL` as distinct in a unique index, so a
household-scoped slot (`member_user_id = NULL`) never collides with a member-scoped slot of the
same key — this matches the design, where household and member slots share a key namespace only
across scopes].

### AC-4 — Tables round-trip through their Zod models
**Given** a row written to each of the five tables,
**When** it is read back and passed to the corresponding Zod schema's `.parse()`,
**Then** parsing succeeds and the parsed object equals the written domain value (enums, JSON
columns, nullable columns, and timestamps all decode to their model types).

### AC-5 — The stack-order columns support top/bottom positioning
**Given** the `objectives` table,
**When** rows are inserted with varying `stack_position` values,
**Then** `stack_position` is a non-null integer usable to order the stack (`MAX(stack_position)`
selects the top; `MIN(stack_position)` the bottom), and `completed_at` is nullable (set only on
pop). This AC verifies the *columns* WI-02 relies on exist; the push/pop *logic* is WI-02.

### AC-6 — Increment-1 substrate is unaffected
**Given** the increment-2 migration is applied on top of the increment-1 schema,
**When** the full migration journal runs from empty,
**Then** all increment-1 tables (`threads`, `thread_messages`, `users`, …) are unchanged and the
existing increment-1 tests still pass (the change is purely additive — new tables only).

## Table & column specification

### `households`
| Column | Drizzle | Constraints |
|---|---|---|
| id | `uuidPk()` | pk |
| name | `text('name')` | nullable |
| owner_user_id | `text('owner_user_id')` | not null, `references(() => users.id)` |
| created_at | `createdAt()` | not null |

### `household_members` — a pure link
| Column | Drizzle | Constraints |
|---|---|---|
| id | `uuidPk()` | pk (house rule — every table) |
| household_id | `text('household_id')` | not null, `references(() => households.id, { onDelete: 'cascade' })` |
| user_id | `text('user_id')` | not null, `references(() => users.id)`, **unique** (one household per user, v1) |

No name/handle/owner/active columns — name→`users.name`, handle→`users.imessage_handle`,
owner→`households.owner_user_id`, `active` deferred to F-04.

### `household_preferences` — 1:1 with `households`, mirrors `user_preferences`
| Column | Drizzle | Notes |
|---|---|---|
| household_id | `text('household_id')` | **pk**, `references(() => households.id, { onDelete: 'cascade' })` (1:1) |
| grocery_stores | `text(..., { mode: 'json' }).$type<(typeof GROCERY_STORES)[number][]>()` | nullable |
| grocery_shopping_day | `text('grocery_shopping_day', { enum: GROCERY_SHOPPING_DAYS })` | nullable |
| weekly_budget_cents | `integer('weekly_budget_cents')` | nullable |
| weekly_meals | `text(..., { mode: 'json' }).$type<{ breakfast; lunch; dinner; snack; kids }>()` | nullable |
| time_by_meal | `text(..., { mode: 'json' }).$type<{ breakfast; lunch; dinner }>()` | nullable |
| time_budget_minutes | `integer('time_budget_minutes')` | nullable |
| cook_days_count | `integer('cook_days_count')` | nullable |
| eats_leftovers | `integer('eats_leftovers', { mode: 'boolean' })` | not null, default `true` |
| owned_equipment | `text(..., { mode: 'json' }).$type<(typeof EQUIPMENT_TYPES)[number][]>()` | nullable |
| equipment_reviewed | `integer('equipment_reviewed', { mode: 'boolean' })` | not null, default `false` |
| household_adults | `integer('household_adults')` | not null, default `2` |
| household_kids | `integer('household_kids')` | not null, default `0` |
| updated_at | `integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())` | not null |

[ASSUMPTION: `grocery_shopping_day` needs an enum tuple. `user_preferences` has no
`grocery_shopping_day` column today, so no existing tuple to mirror. Define
`export const GROCERY_SHOPPING_DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;`
in `src/schema.ts` (a nullable enum-text column, like `whenCook`). Confirm the vocabulary against
the onboarding field map in `02-onboarding.md`; if the client uses a different set (e.g. `weekday`/
`weekend`), adopt that instead.]

[ASSUMPTION: `household_preferences` mirrors only the **household-scoped** subset of
`user_preferences` named in the design (stores, shopping day, budget, meals, time, cook days,
leftovers, equipment, household size). The per-user *ranking* fields (`skill_level`, the six/seven
`weight_*` columns, `budget_cents_per_serving`) are **not** duplicated here — skill is a
member-scoped slot (`mslot("skill_level")`) and weights stay server-owned per user. Confirm with
the founder that household preferences do not need aggregated weights in increment 2.]

### `objectives` — the stack, one row per instance
| Column | Drizzle | Notes |
|---|---|---|
| id | `uuidPk()` | pk |
| thread_id | `text('thread_id')` | not null, `references(() => threads.id, { onDelete: 'cascade' })`, index |
| definition | `text('definition')` | not null — the definition id (`onboarding`, …), resolves to code |
| status | `text('status', { enum: OBJECTIVE_STATUSES })` | not null |
| stack_position | `integer('stack_position')` | not null — the order; higher = nearer the top, active = max |
| context | `text('context', { mode: 'json' }).$type<Record<string, unknown>>()` | nullable |
| created_at | `createdAt()` | not null |
| completed_at | `integer('completed_at', { mode: 'timestamp' })` | nullable — set on pop |

Enum: `export const OBJECTIVE_STATUSES = ['active', 'suspended', 'complete'] as const;`
Index: `index('objectives_thread_idx').on(t.threadId)`.
Partial unique index (hand-added to the migration — see the Background ASSUMPTION):
`objectives_one_active_per_thread` on `(thread_id) WHERE status = 'active'`.

### `slots` — the scoreboard, one row per slot of an objective instance
| Column | Drizzle | Notes |
|---|---|---|
| id | `uuidPk()` | pk |
| objective_id | `text('objective_id')` | not null, `references(() => objectives.id, { onDelete: 'cascade' })`, index |
| key | `text('key')` | not null — e.g. `household.cook_days_count`, `member.allergens` |
| scope | `text('scope', { enum: SLOT_SCOPES })` | not null |
| member_user_id | `text('member_user_id').references(() => users.id)` | nullable — set when `scope = 'member'` |
| required | `integer('required', { mode: 'boolean' })` | not null |
| status | `text('status', { enum: SLOT_STATUSES }).notNull().default('unasked')` | |
| value | `text('value', { mode: 'json' }).$type<unknown>()` | nullable — validated value mirrored from the domain write |
| follow_ups_sent | `integer('follow_ups_sent').notNull().default(0)` | |
| follow_up_timer_id | `text('follow_up_timer_id')` | nullable — durable reminder id |

Enums: `export const SLOT_SCOPES = ['household', 'member'] as const;`
`export const SLOT_STATUSES = ['unasked', 'asked', 'filled', 'defaulted'] as const;`
Indexes: `uniqueIndex('slots_objective_key_member_uidx').on(t.objectiveId, t.key, t.memberUserId)`
and `index('slots_objective_status_idx').on(t.objectiveId, t.status)` (the unfilled-slot query).

### Registration
Add all five tables to the exported `schema` object and export any `New*` insert types that WI-02
needs (`NewHousehold`, `NewHouseholdMember`, `NewHouseholdPreferences`, `NewObjective`, `NewSlot`),
following the existing `NewThread` / `NewThreadMessage` pattern.

## Zod models

One model file per entity under `src/models/`, mirroring `models/thread.ts` (schema + inferred
type export). Enums use `z.enum(OBJECTIVE_STATUSES)` etc. reusing the schema tuples; timestamps
are `z.date()`; JSON columns are typed objects/arrays; nullable columns are `.nullable()`.

- `models/household.ts` — `HouseholdSchema` (`id`, `name: nullable`, `ownerUserId`, `createdAt`).
- `models/household-member.ts` — `HouseholdMemberSchema` (`id`, `householdId`, `userId`).
- `models/household-preferences.ts` — `HouseholdPreferencesSchema` covering every column above,
  with sensible sub-schemas for `weeklyMeals` / `timeByMeal` reused from `user-preferences.ts` if
  they are exported there [ASSUMPTION: reuse the `WeeklyMeals` / `TimeByMeal` shapes; if they are
  not exported from `models/user-preferences.ts`, lift them into a shared location rather than
  redeclaring — memory `code-screams-intent`].
- `models/objective.ts` — `ObjectiveSchema` (`id`, `threadId`, `definition`, `status` enum,
  `stackPosition: z.number().int()`, `context: nullable`, `createdAt`, `completedAt: nullable`).
- `models/slot.ts` — `SlotSchema` (`id`, `objectiveId`, `key`, `scope` enum, `memberUserId:
  nullable`, `required: z.boolean()`, `status` enum, `value: nullable`, `followUpsSent:
  z.number().int()`, `followUpTimerId: nullable`).

## Test Cases

Offline Vitest in `test/**`, each acquiring a fresh db via `migratedFileDb()` (imports the schema
tables and the models directly). No network. As few tests as cover the paths (`server/CLAUDE.md`).

### Test Case 1: Migration applies cleanly and creates the five tables (AC-1, AC-6)
**Preconditions:** schema `0024` generated (partial index hand-corrected) and `src/schema.ts` updated.
**Steps:** call `migratedFileDb()`; query `sqlite_master` for the five table names.
**Expected Outcomes:** `migrate()` resolves without error; all five tables present; increment-1
tables still present (spot-check `threads`, `thread_messages`).

### Test Case 2: Second active objective per thread is rejected; suspended is allowed (AC-2)
**Preconditions:** a `users` row, a `threads` row, and one `objectives` row `status='active'`,
`stack_position=1` for that thread.
**Steps:** (a) insert a second `objectives` row same thread `status='active'`; (b) in a fresh
setup, insert a second row same thread `status='suspended'`.
**Expected Outcomes:** (a) rejects with a unique-constraint error; (b) succeeds.

### Test Case 3: Slot uniqueness on (objective_id, key, member_user_id) (AC-3)
**Preconditions:** an `objectives` row plus two `users` (members A, B).
**Steps:** (a) insert two slots `(obj, 'member.allergens', A)`; (b) insert
`(obj, 'member.allergens', A)` and `(obj, 'member.allergens', B)`; (c) insert
`(obj, 'household.cook_days_count', NULL)` twice.
**Expected Outcomes:** (a) second insert rejects; (b) both succeed (distinct members);
(c) [ASSUMPTION-dependent] the second `NULL` insert succeeds because SQLite treats `NULL` as
distinct — if it instead rejects, the model must synthesize a sentinel, flagged here for review.

### Test Case 4: Round-trip through each Zod model (AC-4)
**Preconditions:** none beyond a migrated db.
**Steps:** insert one representative row per table (JSON columns populated, nullable columns both
null and set across the fixtures), read back, `.parse()` with the matching schema.
**Expected Outcomes:** each `.parse()` succeeds; parsed enums/JSON/dates/nullables equal the input.

### Test Case 5: stack_position ordering + completed_at nullability (AC-5)
**Preconditions:** an `objectives` row.
**Steps:** insert rows with `stack_position` 1, 2, 3; `SELECT MAX(stack_position)` and
`SELECT MIN(stack_position)`; insert a row with `completed_at = NULL` and one with a date.
**Expected Outcomes:** MAX=3, MIN=1; both `completed_at` inserts succeed.

## Test Run

_To be completed by the implementer. Run `npm test` (offline tier) and paste, per test case, the
command, output, and pass/fail. Confirm the increment-1 suite is green (AC-6)._

## Deployment Strategy

Additive only — five new tables, no changes to existing tables or columns (old code runs
unchanged). Two ordered schema steps per the reasoning doc's deployment table:
1. `households`, `household_members`, `household_preferences`;
2. `objectives`, `slots`.

drizzle-kit generates these in one migration file (`0024`); the ordering within the file is
immaterial since it is one transaction. Deploy = `npm run db:migrate` against Turso before the
increment-2 application code ships. Rollback: the tables are unreferenced by increment-1 code, so
a code rollback needs no schema rollback; the additive tables can remain.

**Pre-deploy gate:** verify the deployed migration file contains the **partial** index
(`WHERE status = 'active'`), not a plain unique index on `(thread_id)` — a plain one would reject
every second objective on a thread and break the stack. This is the single highest-risk line.

## Production Verification

### Production Verification 1: Tables live and partial index correct
**Preconditions:** `0024` applied to the Turso production db.
**Steps:** connect to Turso; `SELECT sql FROM sqlite_master WHERE name IN ('objectives','slots','households','household_members','household_preferences','objectives_one_active_per_thread');`
**Expected Outcomes:** all five tables present; the `objectives_one_active_per_thread` index DDL
contains `WHERE "status" = 'active'`.

### Production Verification 2: Active-objective invariant holds in prod
**Preconditions:** a disposable test thread in prod (or a staging Turso branch).
**Steps:** insert two `active` objectives for one thread.
**Expected Outcomes:** the second is rejected by the unique constraint.

## Production Verification Run

_To be completed post-deploy. Paste the `sqlite_master` DDL for the partial index and the
constraint-rejection evidence._
