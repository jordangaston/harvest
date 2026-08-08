# Profile — Sprint Report

**Feature:** avatar (top-right of the recipes screen) → profile screen with the user's name, **Log out**,
and **Delete account** (full server-side account deletion). Built to `DESIGN.md` + `WAVE2-DECISIONS.md §6`.

## What shipped

### Server
- **`DELETE /v1/users/me`** (authGuard, 204) → `UserService.deleteAccount` → `UserRepository.deleteAccount`:
  one transaction deleting, in FK-safe order, `import_jobs` → (`meal_plan_entries`, `grocery_items` —
  `to_regclass`-guarded) → `recipes` (cascades ingredients/steps/joins) → `cookbooks` → the `users` row.
- **No migration** — code-only. No schema change (recipes/import_jobs keep their FKs; ordered deletes avoid
  the `import_jobs.recipe_id` cascade trap — see `DESIGN.md` Decisions).
- Did **not** touch `getMe`: per decision #2, Phone Auth owns adding `name` to `users` + `/me`.

### Mobile
- `lib/api/me.ts` (`getMe`, `deleteAccount`) + `useMe()` / `useDeleteAccount()` hooks (TanStack Query,
  `queryKeys.me`) — reads go through the merged client cache per `docs/client-caching.md`.
- Avatar entry point: the dead placeholder in the recipes header (`recipes.tsx`) is now a `Pressable`
  showing the painterly avatar → `router.push("/profile")`.
- `app/profile.tsx` (pushed full-screen, registered in `_layout.tsx`): `bg-cream` canvas, back chevron,
  avatar + name (null-tolerant "Welcome"), **Log out** row (`bg-card`), **Delete account** (error red).
- Delete confirm: `Modal animationType="slide"` (native slide + scrim; `"none"` under Reduce Motion),
  `bg-cream` sheet, Cancel (`bg-card`) + Delete (new `Button action="error"` = `bg-error`).
- **Teardown ordering** (logout & delete-success): navigate to welcome first, then `clearSession()` +
  `queryClient.clear()` — closes the `apiFetch` re-provision trap flagged in the pre-mortem.

### Art
- `assets/default-avatar.png` — a painterly golden-hour faceless bust generated via the nano-banana-2 MCP,
  on the `#F1E6D2` cream tone so it blends onto the canvas (256px, ~94KB).

## Tests
- **Server suite: 89 passed / 24 files, green offline** on an isolated DB (`vitest run`). New:
  `tests/integration/user-delete.test.ts` (3 tests) — 204 + full cascade + other-user untouched; 401 deletes
  nothing; defensive sibling-table deletes fire on throwaway tables.
- **Mobile `tsc --noEmit`: clean.** **Server `tsc --noEmit`: clean.**
- Tests never hit the network; DB isolated per the brief and **reverted before commit**.

## Demos (Phase 7) — `docs/sprint-profile/demos/`
Live on a dedicated `Harvest-profile` sim against this branch's server + isolated DB. Each sub-story
(S1 delete, S2 profile/avatar/logout, S3 delete modal, S4 avatar art) has a screenshot; the server request
log and DB assertions confirmed the delete actually removed the user and its children with no re-provision.
See `demos/README.md`.

## Cross-task interfaces
- **Consumes** `users.name` via `GET /v1/users/me` (Phone Auth owns it; read null-tolerant — verified in the
  demo, where name is null and the screen shows "Welcome").
- **Owns** `DELETE /v1/users/me`. Its deletion set must cover `meal_plan_entries` + `grocery_items` (sibling
  branches) — implemented defensively (`to_regclass`), to be exercised by the coordinator's post-merge test.
- Logout/Delete use the shared `Button`/`Pressable`, so Instrumentation's "Button Tapped" auto-events cover
  them.

## Migrations
**None.** Profile adds no table/enum/column.

## Top risks / follow-ups
1. **Sibling-table deletion at integration** — `deleteAccount`'s guarded deletes must be verified against the
   real `meal_plan_entries`/`grocery_items` once Meal Planning + Grocery List merge (coordinator's seeded test).
2. **`users.name` depends on Phone Auth** — until it merges, the screen shows "Welcome". Merge order
   Phone Auth → Profile is cleanest, but Profile tolerates null either way.
3. **Environment** (see POSTMORTEM): local Postgres is on **5433** not 5432, the base `package-lock.json` is
   out of sync (missing `react-dom`), and the destructive button reuses the existing `error` token (no
   dedicated `danger`). None block this PR; flagged for the coordinator.
