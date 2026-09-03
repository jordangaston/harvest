# WI-1: Objective v2 Foundation — `tasks` table, models, ObjectiveRepository

> Design source of truth: `docs/objective-system-v2/DESIGN.md`. This spec covers the data + domain
> layer only — no model-facing tools (WI-3).

## Background

The current objective system stores everything in a `slots` table (`server/src/schema.ts`) that
conflates three concerns: the household's *knowledge* (value), the objective's *pursuit state*
(status/required), and *ownership* (objectiveId). Design v2 splits this into a **fact** (typed datum,
a view over existing domain tables) and a **task** (an objective's pursuit — `elicit` points at a
fact; `emit` delivers information). This work item builds the task side: the `tasks` table and the
repository logic. No production data exists (only-us, pre-GA), so the schema change is destructive.

## Objective

Replace `slots` with a `tasks` table and rework `ObjectiveRepository` so an objective is a set of
ordered, optionally-gated tasks of kind `elicit` or `emit`, with completion computed in code across
both kinds. Task rows carry **no value** (Q-01: every fact has a domain-table home).

**Scope — mechanical caller bridge (coordinator decision).** Renaming the core `Slot`→`Task` type
ripples into ~7 importing files. WI-1 performs a **pure mechanical rename** across all of them
(`chef/briefing.ts`, `imessage/consumer.ts`, `imessage/chef.ts`, `chef/types.ts`,
`chef/objectives/index.ts`, `chef/objectives/onboarding.ts`, `chef/objectives/onboarding-identity.ts`)
so the tree compiles and the full suite passes — **no behavior change, no new tools, no onboarding
redefinition** (those are WI-3). Specifically: `householdSlotSpecs`→`householdTaskSpecs` /
`memberSlotSpecs`→`memberTaskSpecs` return `TaskSpec[]` with `kind:'elicit'` and `solo`/`after` unset
(WI-3 sets them); `models/slot.ts` is deleted; `applySlotUpdates`→`applyTaskUpdates`,
`instantiateMemberSlots`→`instantiateMemberTasks`, `markSlotFilled`→`markTaskFilled`. The reasoning
`SlotUpdateSchema`/`slotUpdates` and the consumer's apply call are renamed in place (kept
value-carrying for now); WI-3 removes them.

## Acceptance Criteria

1. **Schema.** A destructive Drizzle migration drops `slots` and creates `tasks` with columns per
   the design's Tables section: `id, objective_id (fk, cascade), kind ('elicit'|'emit'), fact (null),
   fact_type (null), scope ('household'|'member'), member_user_id (fk null), required, status
   (default 'unasked'), solo (default false), after_task_ids (json, default '[]'), follow_ups_sent
   (default 0)`. Indices: `unique(objective_id, fact, member_user_id)`, `index(objective_id, status)`.
   `objectives` is unchanged. `drizzle-kit generate` + `migrate` run clean.
2. **Task model.** `server/src/models/task.ts` exports `TaskSchema` (Zod) with the fields above;
   `Task = z.infer`. Repositories `parse` rows into it at the boundary. `models/slot.ts` is deleted.
3. **Push.** `ObjectiveRepository.pushObjective` accepts `TaskSpec[]` (`kind, fact?, factType?, scope,
   memberUserId?, required, solo, after?`) and inserts the objective plus its task rows. `after` is a
   list of sibling task keys resolved to the inserted row ids and stored in `after_task_ids`.
   Top/bottom stack behavior is unchanged from today.
4. **Eligibility.** `loadActive(threadId)` returns the active objective and its **eligible,
   non-terminal** tasks: a task is eligible when every id in its `after_task_ids` references a
   terminal task (`filled`/`defaulted`). Eligibility is computed in code over the loaded task set (no
   extra query). Terminal tasks are excluded (as `slots` excluded `filled` today).
5. **Apply updates.** `applyTaskUpdates(updates: {taskId, status}[], tx)` sets each task's status by
   id. (Value validation lives in `writeFact`, WI-2 — this method only transitions status.)
6. **Completion.** `isComplete(objectiveId)` is true when zero **required** tasks are non-terminal,
   counting both kinds (an `emit` is terminal only when `filled`). `completeAndPop` is unchanged in
   behavior, operating on `tasks`.
7. **Member tasks.** `instantiateMemberTasks(objectiveId, specs, tx)` inserts member-scoped task rows
   for one identified member, idempotent on `unique(objective_id, fact, member_user_id)` (replaces
   `instantiateMemberSlots`).
8. **All existing repository tests pass**, ported from `slots` to `tasks` semantics.

## Test Cases

### TC-1: Migration is clean and destructive
**Preconditions:** libSQL test DB (`migratedFileDb`) at current head.
**Steps:** run `npm run db:generate` then `db:migrate`; hand-verify the generated SQL (drizzle can't
emit the `objectives` partial unique index — same gotcha applies to any hand-added constraint);
inspect schema.
**Expected:** `slots` gone; `tasks` present with all columns/indices. drizzle's SQLite generator emits
no down-migration; rollback = revert code + a new forward migration that drops `tasks` and recreates
`slots` (see design Deployment).

### TC-2: Push resolves `after` keys to ids
**Preconditions:** empty thread.
**Steps:** push an objective with tasks A, B where B declares `after: [A.key]`.
**Expected:** B's `after_task_ids` holds A's row id; both rows persisted; objective active at pos 0.

### TC-3: Eligibility hides gated tasks
**Preconditions:** objective with A (ungated) and B (`after: [A]`), both `unasked`, required.
**Steps:** `loadActive` before and after A → `filled`.
**Expected:** first call returns A only; after A filled, second call returns B.

### TC-4: Completion across kinds
**Preconditions:** objective with one required `elicit` (filled) and one required `emit` (`asked`).
**Steps:** `isComplete`; then set emit `filled`; `isComplete` again.
**Expected:** false, then true. `completeAndPop` then completes + activates the next suspended (or
empties the stack).

### TC-5: Member task instantiation is idempotent
**Preconditions:** objective pushed; member M identified.
**Steps:** call `instantiateMemberTasks` for M twice.
**Expected:** member task rows created once; second call a no-op (unique conflict ignored).

## Deployment Strategy

Destructive schema migration, deployed with the code. Pre-GA, only-us — no backfill, no flag. Rollback
= revert code + down-migration. Full detail in the design's Deployment section.

## Production Verification

### PV-1: Schema head applied
**Preconditions:** deploy complete.
**Steps:** confirm migration ran; `tasks` exists, `slots` absent.
**Expected:** app boots; a fresh thread seeds an onboarding objective with `tasks` rows (verified end
to end in WI-3).
