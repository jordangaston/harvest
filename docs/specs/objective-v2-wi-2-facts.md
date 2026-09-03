# WI-2: Facts & Fact Types — registries + `writeFact` chokepoint

> Design source of truth: `docs/objective-system-v2/DESIGN.md`.

## Background

Design v2 exposes household/member data to the model as **facts** — a uniform typed surface over the
existing SQL domain tables (`household_preferences`, member profile tables), not new storage. Each
fact has a **type** that owns validation, normalization, legal-value search, and persistence. Today
this logic is scattered across the bespoke `save_household_profile` / `save_member_profile` /
`save_household_goals` tools (enum→catalog-id coercion, budget→cents, allergen confirmed+severity,
like/dislike grounded to a facet+value). This work item relocates that logic into named types behind
one write chokepoint, so validation happens exactly once. No model-facing tools yet (WI-3).

## Objective

Build the `FactDef` registry (flat file), the `FactType` registry (static metadata + dynamic
provider), and `writeFact` — the single function that validates, normalizes, and persists a fact
value to its domain table, returning an instructive rejection on failure.

## Acceptance Criteria

1. **Fact registry.** `server/src/chef/facts/registry.ts` exports a flat map of every onboarding fact
   → `{ key, description, factType, scope, access }`, covering all facts the onboarding objective
   uses (household: grocery_stores, grocery_shopping_day, weekly_budget_cents, weekly_meals,
   time_by_meal, cook_days_count, eats_leftovers, owned_equipment, goals, household_size; member:
   name, allergens, diets, likes, dislikes, skill_level). `household_size` is `access: 'derived'`.
2. **FactType interface.** A `FactType` exposes `name`, `flavor` (`'enum'|'catalog'|'scalar'`),
   `describe()`, `validate(value)`, `normalize(value)`, `search(query, pageToken)` (catalog/enum
   only), `persist(subject, value, tx)`, `read(subject)`. `FactTypeRegistry.get(name)` / `list()`.
3. **Flavors implemented.** enum (e.g. skill_level, grocery_shopping_day), scalar (weekly_budget_cents
   parsed to cents, cook_days_count, time_*_minutes), catalog (grocery_stores, owned_equipment, taste
   facets for likes/dislikes) — reusing the existing catalog/normalization logic from the current
   `save_*` tools. Rich rules preserved: an allergen requires `confirmed:true` + severity; a
   like/dislike must ground to a facet+value.
4. **`writeFact` chokepoint.** `writeFact(factType, subject, value, tx)` validates+normalizes via the
   type, persists to the domain table through the existing repositories
   (`HouseholdPreferenceRepository`, member profile repo), and returns
   `{ ok: true, value }` or `{ ok: false, reason, missing?, closest? }`. A `derived` fact rejects any
   write. This is the only write path; both WI-3 tools front it.
5. **Instructive rejection.** A rejection names what is wrong and what is needed (e.g.
   `ALLERGEN requires severity ∈ {mild,moderate,severe} and confirmed:true`) and, for catalog misses,
   the nearest matches — extending today's `SaveResult.rejected`/`closest` contract.
6. **No behavior regression.** For every value the current `save_*` tools accept/normalize/reject,
   `writeFact` for the corresponding type produces the same persisted value and the same rejection
   signal.

## Test Cases

### TC-1: enum type validates and rejects
**Preconditions:** none.
**Steps:** `writeFact(SKILL_LEVEL, subject, 'wizard', tx)`.
**Expected:** `{ ok:false, reason, closest:[...legal levels] }`; a legal value persists to the member
profile column.

### TC-2: scalar normalizes
**Preconditions:** none.
**Steps:** `writeFact(WEEKLY_BUDGET_CENTS, household, '$120', tx)`.
**Expected:** persists `12000` to `weekly_budget_cents`.

### TC-3: catalog grounds + rejects off-catalog
**Preconditions:** seeded grocery-store catalog.
**Steps:** `writeFact(GROCERY_STORE, household, 'trader joes', tx)` and `'notastore'`.
**Expected:** first persists the canonical id into `grocery_stores`; second `{ ok:false, closest }`.

### TC-4: rich allergen rule
**Preconditions:** member M.
**Steps:** `writeFact(ALLERGEN, M, {value:'peanuts'})` (no severity/confirmed), then with
`{value:'peanuts', severity:'severe', confirmed:true}`.
**Expected:** first `{ ok:false, missing:[severity, confirmed] }`; second persists.

### TC-5: derived fact is read-only
**Preconditions:** household H.
**Steps:** `writeFact` for `household_size`.
**Expected:** `{ ok:false, reason:'derived/read-only' }`; no write.

### TC-6: parity with `save_*`
**Preconditions:** the current save-tool unit fixtures.
**Steps:** run the same input matrix through `writeFact`.
**Expected:** identical persisted values and rejection outcomes.

## Deployment Strategy

Pure additive code (registries + `writeFact`); no schema change here. Ships with WI-3, which switches
tools onto it and deletes the old `save_*` tools.

## Production Verification

Covered end-to-end by WI-3 (a real onboarding turn grounds and persists a fact through `writeFact`).
Standalone: unit + integration suites green against local libSQL (migratedFileDb).
