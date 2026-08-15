---
tags: [harvest, profile], tdd
summary: "Profile — technical design document (avatar → profile screen; logout; full account deletion)"
locked: false
---

# Profile

The avatar in the recipes-screen header opens a profile screen that shows the user's name and two
actions: **Log out** (clear the local session → welcome) and **Delete account** (a `bg-cream`
confirmation → full server-side deletion of the user's data → welcome). Built to
`WAVE2-DECISIONS.md` §6.

**Scope boundaries (per decisions):**
- **No username.** The screen shows `users.name`. **Phone Auth owns** `users.name`, the name-entry
  screen, and create-user wiring; **Profile consumes** the value through `GET /v1/users/me`.
- **Logout is local-only** — clear the stateless session; no server call, no token revocation.
- **Delete is full account deletion** — remove the user's `import_jobs`, `recipes`, `cookbooks`,
  `meal_plan_entries`, `grocery_items`, then the user row, in one transaction, then return to welcome.

---

# Reviews

| Reviewer | Status | Feedback |
|---|---|---|
| Architect | not_started | |
| Founder | not_started | |

---

# Use Case Implementations

Three flows. The recipes-screen avatar is the single entry point.

## Open Profile — Implements F-01: View Profile

~~~mermaid
sequenceDiagram
    participant U as User
    participant R as RecipesScreen
    participant P as ProfileScreen
    participant API as Server (GET /v1/users/me)

    U->>R: tap avatar (header, top-right)
    R->>P: router.push("/profile")
    P->>API: GET /v1/users/me  (Bearer access token)
    API-->>P: { id, phone, name }
    note over P: render name (fallback greeting if name is null)
~~~

## Log Out — Implements F-02: Log Out

~~~mermaid
sequenceDiagram
    participant U as User
    participant P as ProfileScreen
    participant S as SecureStore session

    U->>P: tap "Log out"
    P->>S: clearSession()  (delete harvest.session)
    note over P: no server call — JWT is stateless
    P->>P: router.replace("/(onboarding)/welcome")
~~~

## Delete Account — Implements F-03: Delete Account

~~~mermaid
sequenceDiagram
    participant U as User
    participant P as ProfileScreen
    participant M as ConfirmModal (bg-cream)
    participant API as Server (DELETE /v1/users/me)
    participant DB as Postgres
    participant S as SecureStore session

    U->>P: tap "Delete account"
    P->>M: open (Modal animationType="slide")
    alt User cancels
        U->>M: tap "Cancel"
        M-->>P: close
    else User confirms
        U->>M: tap "Delete"
        note over M: button → loading/disabled
        M->>API: DELETE /v1/users/me  (Bearer access token)
        API->>DB: txn: delete import_jobs → recipes → cookbooks → (meal_plan_entries, grocery_items) → user
        alt 204 No Content
            API-->>M: 204
            M->>S: clearSession()
            M->>P: router.replace("/(onboarding)/welcome")
        else request fails (network / 5xx)
            API-->>M: error
            note over M: keep session; show inline error; re-enable button
        end
    end
~~~

Deletion order matters: `import_jobs` is removed **before** `recipes` because `import_jobs.recipe_id`
references `recipes.id` with no `onDelete` action (a `RESTRICT` that would otherwise block the recipe
delete). `recipes` children (`ingredients`, `recipe_steps`, `cookbook_recipes`, `import_job_recipes`)
fall away via their existing `onDelete: cascade` FKs.

---

# Entities

Profile introduces no new entity. It reads `User.name` and, on delete, removes a `User` and everything
it owns.

~~~mermaid
classDiagram
    class User {
        +uuid id
        +string phone
        +string name
    }
    class Recipe
    class Cookbook
    class ImportJob
    class MealPlanEntry
    class GroceryItem

    User "1" --> "*" Recipe : owns
    User "1" --> "*" Cookbook : owns
    User "1" --> "*" ImportJob : owns
    User "1" --> "*" MealPlanEntry : owns
    User "1" --> "*" GroceryItem : owns
~~~

`name` is added by Phone Auth (§6); `MealPlanEntry` and `GroceryItem` are added by the Meal Planning
and Grocery List tasks. Profile depends on all three at integration (see Cross-Task Interfaces).

---

# Tables

**Profile adds no migration.** No new columns, enums, or indices. `users.name` is Phone Auth's
migration. Deletion is application-level ordered deletes inside a transaction, not a schema change — so
Profile does not add the `onDelete: cascade` FKs that a cascade-based delete would need, and avoids the
`import_jobs.recipe_id` ordering trap that a blanket cascade introduces (see Decisions).

### Changes to existing tables

None.

---

# Modules

Server: one new repository method, one new service method, one new route. Mobile: one new screen, one
made-interactive header element, one confirm modal.

~~~mermaid
classDiagram
    class UserService {
        +getMe(sub) Promise~{id,phone,name}~
        +deleteAccount(userId) Promise~void~
    }
    class UserRepository {
        +findById(id) Promise~User~
        +deleteAccount(userId) Promise~void~
    }
    class DeleteUserRoute {
        +DELETE /v1/users/me
    }
    DeleteUserRoute --> UserService : deleteAccount(authUserId)
    UserService --> UserRepository : deleteAccount(userId)
~~~

`UserRepository.deleteAccount(userId)` runs one `db.transaction`; each child delete is
`where(eq(table.userId, userId))` in FK-safe order, then `delete(users) where id = userId`.
`UserService.deleteAccount` is a thin pass-through (no ownership check needed — the caller can only
delete themselves; `authUserId` is the subject). `getMe` gains `name` in its `select` and return type.

~~~mermaid
flowchart LR
    Avatar[RecipesScreen avatar] -->|router.push| Profile[ProfileScreen]
    Profile -->|GET /v1/users/me| Me[UserService.getMe]
    Profile -->|clearSession + replace| Welcome[welcome]
    Profile -->|confirm| Modal[ConfirmModal]
    Modal -->|DELETE /v1/users/me| Del[UserService.deleteAccount]
    Del -->|txn ordered deletes| DB[(Postgres)]
    Modal -->|on 204: clearSession + replace| Welcome
~~~

---

# APIs

## Delete Account `DELETE /v1/users/me`

Permanently deletes the authenticated user and all data they own. Irreversible.

### Request

- Headers
    - authorization: `Bearer <access jwt>`
- Body: none

### Success Response `204`

- No body. The user row and all owned rows are gone; the presented token no longer resolves to a user.

### Unauthorized Response `401`

- Missing/invalid/expired token (via `authGuard`, unchanged).
- Body
    - error: object
        - code: `"UNAUTHORIZED"`
        - message: string

## View Profile `GET /v1/users/me` (existing — extended)

Already exists and is guarded. **Change:** the response body gains `name` (nullable until the user has
completed the name step). Owner of the change is coordinated in Cross-Task Interfaces.

### Success Response `200`

- Body
    - id: string (uuid)
    - phone: string
    - name: string | null

---

# Cross-Task Interfaces

| Interface | Direction | Detail |
|---|---|---|
| `users.name` column | **consume** (Phone Auth owns) | Displayed on the profile screen. Profile tolerates `null` (renders a generic greeting) so it can merge before Phone Auth if needed. |
| `GET /v1/users/me` returns `name` | **shared** | Requires `getMe` to select+return `name`. If Phone Auth's branch already extends `getMe`, Profile consumes it; otherwise Profile makes the one-line change. Reconciled at integration. |
| Deletion of `meal_plan_entries` + `grocery_items` | **consume** (Meal Planning / Grocery List own the tables) | These tables do not exist on Profile's branch. `UserRepository.deleteAccount` is **extended at integration** to delete them (user-scoped, ordered before/after their recipe FKs as needed). Enforced by the delete integration test asserting all five tables empty (see Testing). |
| `Button` primitive (`components/ui`) | **consume** (Instrumentation owns auto-events) | Logout and Delete use the shared `Button`, so "Button Tapped" auto-events fire without extra wiring. |

**Contract for the deletion set:** account deletion must remove every user-owned row. The
authoritative list lives in `UserRepository.deleteAccount`. Any task adding a user-owned table adds its
delete there (or gives its `user_id` FK `onDelete: cascade`, which the transaction's final
`delete(users)` then clears). The integration test is the backstop.

---

# Mobile Screens & Flows

Honors the design system (`AGENTS.md`) and motion tokens (`lib/motion.ts`).

**Entry point — recipes header.** `app/(app)/recipes.tsx:87` currently renders a dead
`<View className="h-8 w-8 rounded-full bg-sand" />`. Wrap it in a `Pressable` →
`router.push("/profile")`; fill it with a person `Icon` (or the user's first initial once `name` is
cheaply available on this screen — deferred; the glyph is the v1 avatar). Pressable gives the standard
opacity feedback.

**Profile screen — `app/profile.tsx`** (pushed full-screen *over* the tab bar, like `recipe/[id].tsx`;
registered with a `Stack.Screen` in the root layout for a slide animation). Layout:
- `<Backdrop />` + `SafeAreaView` `bg-cream` (a screen canvas, not a sheet — but the canvas tone is
  correct here and rows sit on `bg-card`).
- Header: back chevron (`router.back()`) + title.
- Identity block: avatar glyph + `name` from `GET /v1/users/me` (skeleton/placeholder while loading;
  generic greeting if `null`).
- Row **Log out** — `bg-card` row using the shared `Button`/`Pressable`. No confirmation (reversible via
  phone sign-in, which Phone Auth ships). Handler: `clearSession()` then
  `router.replace("/(onboarding)/welcome")`.
- Row **Delete account** — destructive styling (`text-error` `#B23A2E`, the existing token). Opens the
  confirm modal.

**Delete confirmation modal.** `Modal animationType="slide"` (native slide + scrim, per the motion
rule — no hand-rolled sheet), surface `bg-cream`, buttons on `bg-card`. Copy: title *"Delete your
account?"*, body *"This permanently deletes your recipes, cookbooks, meal plans, and grocery list. This
can't be undone."*, actions **Cancel** (`bg-card`) and **Delete** (`bg-error`/`text-error`). Honors
`AccessibilityInfo.isReduceMotionEnabled()` (skip the slide). On **Delete**: disable the button, call
`DELETE /v1/users/me`; on `204` → `clearSession()` → `router.replace("/(onboarding)/welcome")`; on
failure → keep the session, re-enable, show an inline error (data-loss safety: never clear the session
unless the server confirmed the delete).

**Data-loss guard (why the ordering above):** the client clears the local session and navigates *only*
after a `204`. A failed delete leaves the user logged in with their data intact.

---

# Testing

Offline only — no network, per `server/CLAUDE.md`.

## Test Coverage

| Use Case | Type | Unit | Integration | E2E |
|---|---|---|---|---|
| F-01 View Profile | Flow | | | demo |
| F-02 Log Out | Flow | x (handler) | | demo |
| F-03 Delete Account | Flow | | x | demo |
| `deleteAccount` repo method | Op | | x | |

## Test Approach

### Unit tests
- **Logout/delete client handler** — a small pure function (`onDeleteResult`): given `204` → returns
  `{ clearSession: true, navigate: "welcome" }`; given failure → `{ clearSession: false, error: … }`.
  One runnable check that fails if the data-loss guard regresses. (Mobile has light component-test
  infra; the logic lives in a testable function, the JSX is demoed.)

### Integration tests (Vitest, local Postgres via `tests/helpers/global-setup.ts`)
- **`DELETE /v1/users/me` happy path** — seed a user with a recipe (+ingredients/steps), a cookbook
  (+cookbook_recipes), and an import_job; call the route with the user's token; assert `204` and that
  every seeded row **and** the user row is gone. This is also the backstop for the cross-task deletion
  set: once `meal_plan_entries`/`grocery_items` merge, extend the seed + assertions so a missing delete
  fails the build.
- **`DELETE /v1/users/me` unauthorized** — no/invalid token → `401`, nothing deleted.
- **`getMe` returns `name`** — folded into the existing `/v1/users/me` integration test once `name`
  exists (assert the field is present, `null` before the name step).

### End-to-end / demo
- iOS simulator (mcp `ios-simulator`): open profile from the avatar, log out → welcome; re-enter, open
  profile, delete → confirm modal → welcome; verify the account is gone (a fresh session provisions a
  new user).

## Test Infrastructure
A `seedUserWithData(tx, userId)` helper (recipe + cookbook + import_job) shared by the delete
integration test. Extend it as sibling tables land. No stub servers needed (no external calls).

---

# Deployment

## Migrations

| Order | Type | Description | Backwards-Compatible |
|---|---|---|---|
| — | — | **Profile adds none.** (`users.name` is Phone Auth's migration.) | — |

## Deploy Sequence
Profile's server change (`DELETE /v1/users/me`, `getMe` returning `name`) and mobile change ship
together. `getMe` returning a nullable `name` is backwards-compatible with clients that ignore it.
Ideally Phone Auth (which adds `users.name`) merges first; if not, Profile reads `name` as `null` and
degrades gracefully.

## Rollback Plan
No schema change to roll back. Reverting the code removes the route and the avatar entry point; existing
sessions are unaffected. A user deleted before a rollback stays deleted (irreversible by design).

---

# Monitoring

Client-only Mixpanel (Instrumentation task owns the taxonomy; token NO-OPs in dev/sim/test).

## Metrics

| Name | Type | Use Case | Description |
|---|---|---|---|
| Account Deleted | event | F-03 | Fires on `204`. Confirms the destructive flow completes. |
| Logged Out | event | F-02 | Fires on logout. |

`Button Tapped` auto-events on the shared `Button` already cover the taps; the two named events above
mark flow completion. Final names/props defer to Instrumentation's taxonomy.

## Alerts / Dashboards / Logging
None specific to Profile. Server logs the existing request line; no new structured fields (avoid logging
user ids on a deletion path).

---

# Decisions

## Delete via ordered transactional deletes, not FK cascade

**Framework:** Direct criterion — correctness under the existing FK graph.

A cascade-based delete (`delete(users)` with `onDelete: cascade` added to `recipes.user_id` and
`import_jobs.user_id`) is fewer lines, but `import_jobs.recipe_id → recipes.id` has **no** `onDelete`
action. Under a single `delete(users)`, Postgres may delete a referenced recipe before the referencing
import_job, raising a foreign-key violation. Adding cascade to `recipes.user_id` would therefore also
force changing `import_jobs.recipe_id` — spreading schema changes for a delete that ordered application
code does cleanly. Ordered deletes (`import_jobs → recipes → cookbooks → user`) respect every FK with no
migration and keep the full deletion set in one readable, testable place.

**Choice:** Ordered transactional deletes in `UserRepository.deleteAccount`. No migration; the founder's
enumerated deletion set (§6) maps directly onto the ordered statements.

### Alternatives Considered
- **`onDelete: cascade` + `delete(users)`:** rejected — the `import_jobs.recipe_id` FK makes it
  incorrect without further schema changes, and it hides the deletion set in the schema.
- **Per-table `DELETE /v1/...` calls from the client:** rejected — multiple round-trips, non-atomic,
  partial-failure orphans.

## Logout is client-only (no token revocation)

**Framework:** Direct criterion — laziest correct path for a single-device, stateless-JWT v1.

Access tokens are stateless and short-lived (15m); there is no shared-device threat model in v1. Bumping
the token nonce server-side adds a call and a repo method for no v1 benefit. `clearSession()` +
navigate is sufficient and matches the decision ("logout = local-only").

**Choice:** `clearSession()` then `router.replace("/(onboarding)/welcome")`.

## Profile is a pushed full-screen route, not a bottom sheet

**Framework:** Direct criterion — consistency + destructive-action gravity.

Matches Recime and the existing `recipe/[id]`/`cookbook/[id]` pattern (full-screen pushed over the
tabs). A dedicated screen gives the delete action room and a confirm modal, and reuses the standard
Stack slide animation.

---

# Open Questions

| ID | Question | Status | Resolution |
|---|---|---|---|
| Q-01 | Who edits `getMe` to return `name` — Phone Auth (owner of `users.name`) or Profile at integration? | open | Default: Profile makes the one-line change if Phone Auth hasn't; reconcile at integration. |
| Q-02 | Confirm the destructive **Delete** button may use the existing `error` token (`#B23A2E`) — no dedicated `danger` token exists. | open | Recommend reusing `error`; add a `danger` alias only if the Architect prefers a distinct name. |
| Q-03 | Should logout show a light confirmation, or log out immediately? | open | Recommend immediate (reversible via phone sign-in). |
| Q-04 | Does Profile display anything beyond `name` + the two actions (e.g., phone number, join date)? | open | Recommend name + Log out + Delete only, per §6 scope. |

---

# Appendix A — Changelog

| Date | Author | Change |
|---|---|---|
| 2026-08-07 | Profile Lead | Initial draft, built to WAVE2-DECISIONS.md §6. |
