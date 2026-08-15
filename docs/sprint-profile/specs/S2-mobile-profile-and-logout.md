# S2 — Mobile: profile screen, avatar entry point, logout

**Goal:** the recipes-header avatar opens a profile screen showing the user's name + a Log out action.
Implements DESIGN F-01, F-02.

## Files
- `lib/api/me.ts` — new: `getMe()` → `GET /v1/users/me`, returns `{ id, phone, name? }`.
- `lib/api/types.ts` — add `ApiMe` (`name?: string | null`).
- `lib/api/hooks.ts` — add `useMe()` (`useQuery`, key `queryKeys.me`).
- `app/(app)/recipes.tsx` — make the header avatar (`recipes.tsx:87`) a `Pressable` → `router.push("/profile")`, filled with the default-avatar image.
- `app/profile.tsx` — new pushed full-screen route.
- `app/_layout.tsx` — register `Stack.Screen name="profile"` (default slide).
- `assets/default-avatar.png` — painterly avatar (done in S4).

## Behaviour
- `useMe()` reads `/v1/users/me`; `name` is optional (null-tolerant until Phone Auth merges).
- Profile screen: `<Backdrop/>` + `SafeAreaView bg-cream`; back chevron (`router.back()`); identity block
  (default avatar + name, or a generic greeting like "Welcome" when name is null/loading); a **Log out**
  `bg-card` row (shared `Button`/`Pressable`).
- **Log out** handler: `clearSession()` → `queryClient.clear()` → `router.replace("/(onboarding)/welcome")`.
  No confirmation (reversible via phone sign-in).

## Acceptance criteria → tests/demo
| AC | Check |
|---|---|
| Avatar in the recipes header opens the profile screen | sim demo |
| Profile shows the default painterly avatar + name (or generic greeting when null) | sim demo (name null pre-Phone-Auth → greeting) |
| Log out clears session + cache and lands on welcome | sim demo; unit test on the pure result-handler |
| No `bg-white`; canvas `bg-cream`, rows `bg-card`; Lora/Karla | code review vs AGENTS.md |

## Notes
- Do not hand-roll fetching — `useMe()` via TanStack Query per `docs/client-caching.md`.
