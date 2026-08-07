---
tags: [harvest, cleanup, spec]
story: C2
summary: "Onboarding becomes typed pg enum / enum[] columns on users; jsonb dropped; mobile accumulates label→enum and Cleanup owns the POST /v1/users wiring."
source: docs/sprint-cleanup/DESIGN.md (Revision 2 — 'users — changes (C2)', 'Signup with onboarding', APIs, Testing, Migrations), docs/sprint-cleanup/ARCHITECT-REVIEW.md (S1)
---

# C2 — Onboarding as typed enum columns + signup wiring

## Summary

Replace the untyped `onboarding jsonb` blob on `users` with **typed pg enum / enum[] columns** plus an
`onboarding_completed_at timestamptz`. Thread the typed onboarding through the server boundary
(`createUserSchema`), service (`UserService.createUser` / `provision`), repository
(`UserRepository.insert`), and domain model (`UserSchema`).

On mobile, add an accumulator (`lib/onboarding.ts`) holding the **display-label → enum-value map**;
each `app/(onboarding)/` screen writes its selection into it. **Cleanup owns the `POST /v1/users`
wiring this sprint** — `provisionUser` in `lib/api/auth.ts` must send the accumulated onboarding at
signup (today it posts only `phone_number`). Wave-2 Phone Auth later swaps in the real phone
(resolves Architect S1).

Two verified live facts drive this (DESIGN.md; ARCHITECT-REVIEW.md S1):
- Every onboarding screen keeps its answer in local `useState` and only `router.push`es — **nothing is
  lifted or POSTed today** (confirmed: `app/(onboarding)/goals.tsx:19` holds `selected` in `useState`,
  navigates on CTA, sends nothing).
- `provisionUser` (`lib/api/auth.ts:38`) posts `{ user: { phone_number } }` only.

## Split across two migrations (per the design)

The design's Migrations table splits C2's DDL. **This is deliberate — note it, don't collapse it:**
- **0007 (C2):** create the seven enum types; **add** the enum / enum[] columns +
  `onboarding_completed_at`; **drop `onboarding jsonb`**.

The prompt frames these as "enums added in 0007, jsonb dropped in 0008" per a non-interactive split; if
the implementer keeps the drop in 0007 alongside the adds (as DESIGN.md's Migrations table 0007 row
reads — *"`users` drop `onboarding jsonb`; add 7 enum/enum[] columns + `onboarding_completed_at`"*),
that is the source-of-truth ordering. Either way the end state is identical: **enum columns exist,
`onboarding` jsonb is gone.** Generate migrations with `drizzle-kit generate` (never hand-edit DDL) and
keep numbering sequential after `0006` (C6). Destructive is fine — pre-launch, no backfill.

## Acceptance Criteria

- **Schema:** `users` has columns `goals goal[]`, `recipe_sources recipe_source[]`, `cook_days
  weekday[]`, `when_cook when_cook`, `cook_time cook_time`, `how_heard how_heard`, `age age_band`, and
  `onboarding_completed_at timestamptz` — all nullable (a user may skip a screen).
- The seven pg enum types (`goal`, `recipe_source`, `weekday`, `when_cook`, `cook_time`, `how_heard`,
  `age_band`) exist with the exact values from the DESIGN.md label→value table.
- The `onboarding jsonb` column no longer exists.
- `createUserSchema` (`server/src/api/schemas.ts`) rejects an **unknown enum value** (e.g.
  `goals: ['not_a_goal']` → parse throws); accepts a valid typed onboarding object; onboarding remains
  optional and every field within it optional.
- `UserService.createUser` persists the typed onboarding and sets `onboarding_completed_at = now()`
  when onboarding is present on a newly provisioned user.
- The mobile accumulator (`lib/onboarding.ts`) maps each **display label** to its **enum value** (e.g.
  `"Eat healthier" → "eat_healthier"`) and stores the enum values.
- Signup (`provisionUser`, `lib/api/auth.ts`) POSTs the accumulated onboarding in the `user.onboarding`
  body alongside `phone_number`.
- Any onboarding UI touched honours the binding: **no `bg-white`** (use `bg-cream` sheet / `bg-card`
  rows per AGENTS.md); any motion uses `lib/motion.ts` tokens, not hardcoded durations.

## Files & functions touched

### Server

| Path | Symbol | Change |
|---|---|---|
| `server/src/db/schema/enums.ts` | new `pgEnum` exports | Add `goalEnum`, `recipeSourceEnum`, `weekdayEnum`, `whenCookEnum`, `cookTimeEnum`, `howHeardEnum`, `ageBandEnum` (follow the existing `sourceTypeEnum` / `importJobStatusEnum` pattern at `:3`, `:19`). |
| `server/src/db/schema/users.ts` | `users` table (currently has `onboarding: jsonb('onboarding')`) | Drop the `jsonb` `onboarding` column; add the seven enum / `.array()` enum columns + `onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true })`. |
| `server/drizzle/` | migration `0007` (via `drizzle-kit generate`) | Create enums, drop `onboarding`, add the new columns. |
| `server/src/api/schemas.ts` | `createUserSchema` (`:11-16`) | Replace `onboarding: z.unknown().optional()` with a typed optional object: `goals: z.array(z.enum([...])).optional()`, `recipe_sources`, `cook_days` as `z.array(z.enum([...]))`; `when_cook`, `cook_time`, `how_heard`, `age` as `z.enum([...])` — each `.optional()`. Enum member lists mirror the pg enums exactly. |
| `server/src/models/user.ts` | `UserSchema` (`:4-13`) | Replace `onboarding: z.unknown().nullable()` with the typed enum fields (nullable, matching the columns) + `onboardingCompletedAt: z.date().nullable()`. |
| `server/src/services/user-service.ts` | `CreateUserRequest` (`:10-13`), `createUser` (`:46`), `provision` (`:156`) | Retype `onboarding` from `unknown` to the typed onboarding shape; in `provision`, set `onboardingCompletedAt = new Date()` when onboarding is present. |
| `server/src/repositories/user-repository.ts` | `insert` (`:39`) | Retype the `onboarding` param; write the enum / enum[] columns + `onboardingCompletedAt`. |
| `server/src/api/app.ts` | POST `/v1/users` handler (`:88-89`) | No shape change — it already passes `user.onboarding` through; the type flows from the updated schema. Verify it still compiles. |

### Mobile

| Path | Symbol | Change |
|---|---|---|
| `lib/onboarding.ts` | **new** — accumulator + label→enum map | Module holding the display-label→enum-value map for all seven fields and a mutable accumulator; `set(field, label)` stores the enum value; a getter returns the assembled `onboarding` object for POST. |
| `app/(onboarding)/goals.tsx`, `recipe-sources.tsx`, `cook-time.tsx` (weekday + cook_time), `when-cook.tsx`, `how-heard.tsx`, `age.tsx` | each screen's selection handler | On selection / CTA, write the chosen label(s) into the accumulator (in addition to existing local `useState` + `router.push`). |
| `lib/api/auth.ts` | `provisionUser` (`:38-43`) | Read the accumulated onboarding and include it in the POST body: `{ user: { phone_number: phone, onboarding } }`. |

## Implementation notes

### Enum types + label→value map (from DESIGN.md 'users — changes (C2)')

Stable snake_case enum values; display labels map to them so re-wording a label needs no migration.
Read labels from `app/(onboarding)/`; the exact per-field mapping is the DESIGN.md table:

- **`goal`** (`goals.tsx:7-15`): `eat_healthier`←Eat healthier · `save_money`←Save money ·
  `improve_cooking`←Improve cooking skills · `organize_recipes`←Organize recipes · `plan_meals`←Plan out
  meals · `meal_prepping`←Meal prepping · `try_new_cuisines`←Try new cuisines
- **`recipe_source`** (`recipe-sources.tsx:19-41`): `social_media` · `recipe_websites` ·
  `printed_handwritten`
- **`weekday`** (`cook-time.tsx:7`): `mon` · `tue` · `wed` · `thu` · `fri` · `sat` · `sun`
- **`when_cook`** (`when-cook.tsx:7-13`): `morning_plan_ahead` · `lunchtime` · `evening_ready` ·
  `weekly_schedule` · `meal_prep`
- **`cook_time`** (`cook-time.tsx:8`): `before_5pm` · `from_5_to_6pm` · `from_6_to_7pm` ·
  `from_7_to_8pm` · `after_8pm`
- **`how_heard`** (`how-heard.tsx:15-26`): `tiktok` · `google_search` · `youtube` · `instagram` ·
  `pinterest` · `email_newsletter` · `app_store_search` · `facebook` · `friend`←Through a friend ·
  `other`
- **`age_band`** (`age.tsx:7`): `under_24`←24 and under · `from_25_to_34`←25-34 · `from_35_to_44`←35-44
  · `from_45_to_54`←45-54 · `over_55`←55+

Confirm each screen's live label strings against the files before wiring the map — the map is only
correct if it mirrors what the screens render.

### Server threading

- `createUserSchema` is the boundary chokepoint (`server/CLAUDE.md`: Zod-at-boundary). Model the enum
  members inline so an unknown value fails the parse — that is the acceptance guarantee, not a runtime
  check elsewhere.
- Repositories `parse` rows back into `UserSchema` at the boundary — keep that; retype the fields.
- `onboarding_completed_at` is set server-side (`now()`) in `provision`, per the sequence diagram
  ("Signup with onboarding": *"insert enum / enum[] columns + onboarding_completed_at = now()"*). It is
  not sent by the client.

### Mobile accumulator

- `lib/onboarding.ts` is a plain module-level accumulator (mirrors the existing lightweight
  `lib/savedToast.ts` shape — no store framework). It holds label→enum maps per field and the running
  selection; screens push into it; `provisionUser` drains it.
- Any onboarding screen chrome you touch: **no `bg-white`** (AGENTS.md white rule); if you animate a
  selection or transition, use `lib/motion.ts` tokens.

## Test cases (offline — tests never hit the network)

| Acceptance criterion | Test |
|---|---|
| Typed onboarding round-trips through the service | **Extend** `server/tests/unit/user-service.test.ts` (the `:56-59` case): `createUser({ phoneNumber, onboarding: { goals: ['eat_healthier'], age: 'from_25_to_34' } })` → `first.user.onboarding`-equivalent typed fields round-trip via `FakeUserRepository`; assert `onboarding_completed_at` set. Update `FakeUserRepository.insert` + `UserSchema.parse` fixture (`:20-33`) to the typed shape. |
| `createUserSchema` rejects unknown enum values | **New unit test** (co-located schema test, offline): `createUserSchema.parse({ user: { phone_number: '+15555550123', onboarding: { goals: ['not_a_goal'] } } })` throws; a valid enum object parses; omitting `onboarding` parses. |
| Accumulator maps labels → enums | **New unit test** for `lib/onboarding.ts`: `set('goals', 'Eat healthier')` → the drained onboarding contains `goals: ['eat_healthier']`; every field's label→value pair from the map is covered; an unknown label is not silently mapped. |
| Enum columns exist; jsonb gone; enum types exist | **Update** `server/tests/integration/scaffold.test.ts` (the schema-audit `describe`): assert the seven new enum types exist in `pg_type` (extend the `:50-54` enum query), assert the new `users` columns exist (query `information_schema.columns`), and **assert `users` has no `onboarding` column**. |
| Signup POSTs onboarding | Covered by the C2 integration flow in the existing user/signup integration tests (server side asserts the persisted enum columns after a create); the mobile `provisionUser` body is asserted in the `lib/onboarding.ts` / auth unit test via a mocked `fetch` (offline). |

All tests run against the offline stubs / local Postgres migrated by
`server/tests/helpers/global-setup.ts` — no network. Per `server/CLAUDE.md`: don't test the Zod parse
itself beyond the one unknown-enum rejection that is a stated acceptance criterion.

## Out of scope / non-goals

- Phone Auth / real phone-number capture (Wave-2 swaps in the real phone; Cleanup uses the generated
  phone).
- Any recipe, nutrition, ownership, or catalog work (C3–C6, C5a) — separate specs.
- Building a state-management framework for the accumulator — a plain module (like `lib/savedToast.ts`)
  is enough.
- Backfilling existing onboarding data (pre-launch, destructive migration is intended; no data).
- Redesigning the onboarding screens' layout or copy beyond wiring selections into the accumulator.
