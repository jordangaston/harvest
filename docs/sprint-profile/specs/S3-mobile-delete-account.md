# S3 — Mobile: delete-account confirm modal + mutation

**Goal:** a destructive "Delete account" action on the profile screen, gated by a `bg-cream` confirm
modal, that calls the server delete and returns to welcome. Implements DESIGN F-03 (client half).

## Files
- `lib/api/me.ts` — add `deleteAccount()` → `DELETE /v1/users/me`.
- `lib/api/hooks.ts` — add `useDeleteAccount()` (`useMutation`).
- `app/profile.tsx` — add the Delete row + confirm modal.

## Behaviour
- **Delete account** row: destructive styling (`text-error` `#B23A2E`). Opens the confirm modal.
- **Confirm modal:** `Modal animationType="slide"` (native slide + scrim — no hand-rolled sheet), surface
  `bg-cream`, buttons on `bg-card`. Copy: title *"Delete your account?"*, body *"This permanently deletes
  your recipes, cookbooks, meal plans, and grocery list. This can't be undone."*, actions **Cancel**
  (`bg-card`) and **Delete** (destructive). Honors `AccessibilityInfo.isReduceMotionEnabled()`.
- **Delete** press: disable button; `useDeleteAccount()` → `DELETE /v1/users/me`.
  - On success (204): `clearSession()` → `queryClient.clear()` → `router.replace("/(onboarding)/welcome")`.
  - On failure: keep session, re-enable, show inline error. **Never clear the session unless the server
    confirmed the delete** (data-loss guard).

## Acceptance criteria → tests/demo
| AC | Check |
|---|---|
| Delete row opens the `bg-cream` slide modal | sim demo |
| Cancel dismisses, no call | sim demo |
| Confirm deletes and lands on welcome; re-entry provisions a fresh user | sim demo |
| Failed delete keeps the user logged in with data intact | unit test on the pure result-handler |
| Reduce Motion skips the slide | code review |

## Notes
- Reuse the shared `Button` so Instrumentation's "Button Tapped" auto-event covers the taps.
